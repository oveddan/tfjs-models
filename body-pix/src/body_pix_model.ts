
/**
 * @license
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import * as tfconv from '@tensorflow/tfjs-converter';
import * as tf from '@tensorflow/tfjs-core';

import {resNet50Checkpoint} from './checkpoints';
import {decodePartSegmentation, toMask} from './decode_part_map';
import {assertValidOutputStride, MobileNetMultiplier, OutputStride} from './mobilenet';
import {decodeMultipleMasks} from './multi_person/decode_multiple_masks';
import {decodeMultiplePoses} from './multi_person/decode_multiple_poses';
import {ResNet} from './resnet';
import {BodyPixInput, PartSegmentation, PersonSegmentation} from './types';
import {flipPosesHorizontal /*toInputTensor*/, getInputTensorDimensions, padAndResizeTo, scaleAndCropToInputTensorShape, scaleAndFlipPoses, toTensorBuffers3D} from './util';

export type BodyPixInputResolution =
    161|193|257|289|321|353|385|417|449|481|513|801|1217;
export type BodyPixOutputStride = 32|16|8;
export type BodyPixArchitecture = 'ResNet50'|'MobileNetV1';
export type BodyPixDecodingMethod = 'single-person'|'multi-person';
export type BodyPixQuantBytes = 1|2|4;

/**
 * BodyPix supports using various convolution neural network models
 * (e.g. ResNet and MobileNetV1) as its underlying base model.
 * The following BaseModel interface defines a unified interface for
 * creating such BodyPix base models. Currently both MobileNet (in
 * ./mobilenet.ts) and ResNet (in ./resnet.ts) implements the BaseModel
 * interface. New base models that conform to the BaseModel interface can be
 * added to BodyPix.
 */
export interface BaseModel {
  // The output stride of the base model.
  readonly outputStride: BodyPixOutputStride;

  /**
   * Predicts intermediate Tensor representations.
   *
   * @param input The input RGB image of the base model.
   * A Tensor of shape: [`inputResolution`, `inputResolution`, 3].
   *
   * @return A dictionary of base model's intermediate predictions.
   * The returned dictionary should contains the following elements:
   * heatmapScores: A Tensor3D that represents the heatmapScores.
   * offsets: A Tensor3D that represents the offsets.
   * displacementFwd: A Tensor3D that represents the forward displacement.
   * displacementBwd: A Tensor3D that represents the backward displacement.
   */
  predict(input: tf.Tensor3D): {[key: string]: tf.Tensor3D};
  /**
   * Releases the CPU and GPU memory allocated by the model.
   */
  dispose(): void;
}

/**
 * BodyPix model loading is configurable using the following config dictionary.
 *
 * `architecture`: PoseNetArchitecture. It determines wich PoseNet architecture
 * to load. The supported architectures are: MobileNetV1 and ResNet.
 *
 * `outputStride`: Specifies the output stride of the PoseNet model.
 * The smaller the value, the larger the output resolution, and more accurate
 * the model at the cost of speed.  Set this to a larger value to increase speed
 * at the cost of accuracy. Stride 32 is supported for ResNet and
 * stride 8,16,32 are supported for various MobileNetV1 models.
 *
 * `multiplier`: An optional number with values: 1.01, 1.0, 0.75, or
 * 0.50. The value is used only by MobileNet architecture. It is the float
 * multiplier for the depth (number of channels) for all convolution ops.
 * The larger the value, the larger the size of the layers, and more accurate
 * the model at the cost of speed. Set this to a smaller value to increase speed
 * at the cost of accuracy.
 *
 * `modelUrl`: An optional string that specifies custom url of the model. This
 * is useful for area/countries that don't have access to the model hosted on
 * GCP.
 *
 * `quantBytes`: An opional number with values: 1, 2, or 4.  This parameter
 * affects weight quantization in the models. The available options are
 * 1 byte, 2 bytes, and 4 bytes. The higher the value, the larger the model size
 * and thus the longer the loading time, the lower the value, the shorter the
 * loading time but lower the accuracy.
 */
export interface ModelConfig {
  architecture: BodyPixArchitecture;
  outputStride: BodyPixOutputStride;
  inputResolution: BodyPixInputResolution;
  multiplier?: MobileNetMultiplier;
  modelUrl?: string;
  quantBytes?: BodyPixQuantBytes;
}

// The default configuration for loading MobileNetV1 based PoseNet.
//
// (And for references, the default configuration for loading ResNet
// based PoseNet is also included).
//
const RESNET_CONFIG = {
  architecture: 'ResNet50',
  outputStride: 32,
  quantBytes: 2,
} as ModelConfig;


export class BodyPix {
  baseModel: BaseModel;
  inputResolution: BodyPixInputResolution;

  constructor(net: BaseModel, inputResolution: BodyPixInputResolution) {
    this.baseModel = net;
    this.inputResolution = inputResolution;
  }

  predictForSegmentation(input: tf.Tensor3D): tf.Tensor3D {
    return this.baseModel.predict(input).segmentation.sigmoid();
  }

  predictForSegmentationAndLongRangeOffsets(input: tf.Tensor3D): {
    segmentLogits: tf.Tensor3D,
    longOffsets: tf.Tensor3D,
    heatmapScores: tf.Tensor3D,
    offsets: tf.Tensor3D,
    displacementFwd: tf.Tensor3D,
    displacementBwd: tf.Tensor3D
  } {
    const {
      segmentation,
      longOffsets,
      heatmapScores,
      offsets,
      displacementFwd,
      displacementBwd
    } = this.baseModel.predict(input);
    return {
      segmentLogits: segmentation, longOffsets: longOffsets,
          heatmapScores: heatmapScores, offsets: offsets,
          displacementFwd: displacementFwd, displacementBwd: displacementBwd
    }
  }

  predictForPartMap(input: tf.Tensor3D):
      {segmentScores: tf.Tensor3D, partHeatmapScores: tf.Tensor3D} {
    const {segmentation, partHeatmaps} = this.baseModel.predict(input);
    return {
      segmentScores: segmentation.sigmoid(),
          partHeatmapScores: partHeatmaps.sigmoid()
    }
  }

  /**
   * Given an image with a person, returns a binary array with 1 for the pixels
   * that are part of the person, and 0 otherwise. This does
   * standard ImageNet pre-processing before inferring through the model. Will
   * resize and crop the image to 353 x 257 while maintaining the original
   * aspect ratio before feeding through the network. The image pixels
   * should have values [0-255].
   *
   * @param input ImageData|HTMLImageElement|HTMLCanvasElement|HTMLVideoElement)
   * The input image to feed through the network.
   *
   * @param outputStride the desired stride for the outputs.  Must be 32, 16,
   * or 8. Defaults to 16. The output width and height will be will be
   * (inputDimension - 1)/outputStride + 1
   *
   * @param segmentationThreshold The minimum that segmentation values must have
   * to be considered part of the person.  Affects the generation of the
   * segmentation mask.
   *
   * @return An object containing a width, height, and a binary array with 1 for
   * the pixels that are part of the person, and 0 otherwise. The array size
   * corresponds to the number of pixels in the image.  The width and height
   * correspond to the dimensions of the image the binary array is shaped to,
   * which are the same dimensions of the input image.
   */
  async estimatePersonSegmentation(
      input: BodyPixInput, outputStride: OutputStride = 16,
      segmentationThreshold = 0.5): Promise<PersonSegmentation> {
    assertValidOutputStride(outputStride);

    const [height, width] = getInputTensorDimensions(input);
    const inputResolution = this.inputResolution;

    let pad = null;
    const {
      segmentation,
      longOffsets,
      heatmapScores,
      offsets,
      heatmapScoresRaw,
      offsetsRaw,
      displacementFwdRaw,
      displacementBwdRaw,
    } = tf.tidy(() => {
      const {resized, padding} =
          padAndResizeTo(input, [inputResolution, inputResolution]);
      pad = padding;
      // const segmentScores = this.predictForSegmentation(resized);
      const {
        segmentLogits,
        longOffsets,
        heatmapScores,
        offsets,
        displacementFwd,
        displacementBwd
      } = this.predictForSegmentationAndLongRangeOffsets(resized);

      const scaledSegmentScores =
          scaleAndCropToInputTensorShape(
              segmentLogits, [height, width],
              [inputResolution, inputResolution],
              [[padding.top, padding.bottom], [padding.left, padding.right]])
              .sigmoid();

      const scaledLongOffsets = scaleAndCropToInputTensorShape(
          longOffsets, [height, width], [inputResolution, inputResolution],
          [[padding.top, padding.bottom], [padding.left, padding.right]]);

      const scaledOffsets = scaleAndCropToInputTensorShape(
          offsets, [height, width], [inputResolution, inputResolution],
          [[padding.top, padding.bottom], [padding.left, padding.right]]);

      const scaledHeatmapScores = scaleAndCropToInputTensorShape(
          heatmapScores, [height, width], [inputResolution, inputResolution],
          [[padding.top, padding.bottom], [padding.left, padding.right]]);

      return {
        segmentation:
            toMask(scaledSegmentScores.squeeze(), segmentationThreshold),
        longOffsets: scaledLongOffsets,
        offsets: scaledOffsets,
        heatmapScores: scaledHeatmapScores,
        heatmapScoresRaw: heatmapScores,
        offsetsRaw: offsets,
        displacementFwdRaw: displacementFwd,
        displacementBwdRaw: displacementBwd,
      };
    });

    const result = await segmentation.data() as Uint8Array;
    const result2 = await longOffsets.data() as Float32Array;
    const result3 = await heatmapScores.data() as Float32Array;
    const result4 = await offsets.data() as Float32Array;

    const [scoresBuffer, offsetsBuffer, displacementsFwdBuffer, displacementsBwdBuffer] =
        await toTensorBuffers3D([
          heatmapScoresRaw, offsetsRaw, displacementFwdRaw, displacementBwdRaw
        ]);

    let poses = await decodeMultiplePoses(
        scoresBuffer, offsetsBuffer, displacementsFwdBuffer,
        displacementsBwdBuffer, outputStride, 30, 0.3, 20);

    poses = scaleAndFlipPoses(
        poses, [height, width], [inputResolution, inputResolution], pad,
        /*true*/ false);

    const instanceMasks =
        decodeMultipleMasks(result, result2, poses, height, width);
    poses = flipPosesHorizontal(poses, width);

    segmentation.dispose();

    return {
      height,
      width,
      // data: result,
      data: instanceMasks.data,
      data2: result2,
      data3: result3,
      data4: result4,
      poses: poses
    };
  }

  /**
   * Given an image with a person, returns an array with a part id from 0-24 for
   * the pixels that are part of a corresponding body part, and -1 otherwise.
   * This does standard ImageNet pre-processing before inferring through the
   * model. Will resize and crop the image to 353 x 257 while maintaining the
   * original aspect ratio before feeding through the network. The image should
   * pixels should have values [0-255].
   *
   * @param input ImageData|HTMLImageElement|HTMLCanvasElement|HTMLVideoElement)
   * The input image to feed through the network.
   *
   * @param outputStride the desired stride for the outputs.  Must be 32, 16,
   * or 8. Defaults to 16. The output width and height will be will be
   * (inputDimension - 1)/outputStride + 1
   *
   * @param segmentationThreshold The minimum that segmentation values must have
   * to be considered part of the person.  Affects the clipping of the colored
   * part image.
   *
   * @return An object containing a width, height, and an array with a part id
   * from 0-24 for the pixels that are part of a corresponding body part, and -1
   * otherwise. The array size corresponds to the number of pixels in the image.
   * The width and height correspond to the dimensions of the image the array is
   * shaped to, which are the same dimensions of the input image.
   */
  async estimatePartSegmentation(
      input: BodyPixInput, outputStride: OutputStride = 16,
      segmentationThreshold = 0.5): Promise<PartSegmentation> {
    assertValidOutputStride(outputStride);

    const [height, width] = getInputTensorDimensions(input);
    const inputResolution = this.inputResolution;

    const partSegmentation = tf.tidy(() => {
      const {resized, padding} =
          padAndResizeTo(input, [inputResolution, inputResolution]);
      const {segmentScores, partHeatmapScores} =
          this.predictForPartMap(resized);

      const scaledSegmentScores = scaleAndCropToInputTensorShape(
          segmentScores, [height, width], [inputResolution, inputResolution],
          [[padding.top, padding.bottom], [padding.left, padding.right]]);

      const scaledPartHeatmapScore = scaleAndCropToInputTensorShape(
          partHeatmapScores, [height, width],
          [inputResolution, inputResolution],
          [[padding.top, padding.bottom], [padding.left, padding.right]]);

      const segmentationMask =
          toMask(scaledSegmentScores.squeeze(), segmentationThreshold);

      return decodePartSegmentation(segmentationMask, scaledPartHeatmapScore);
    });

    const data = await partSegmentation.data() as Int32Array;

    partSegmentation.dispose();

    return {height, width, data};
  }

  public dispose() {
    this.baseModel.dispose();
  }
}

/**
 * Loads the ResNet BodyPix model.
 */
async function loadResNet(config: ModelConfig): Promise<BodyPix> {
  const outputStride = config.outputStride;
  const quantBytes = config.quantBytes;
  if (tf == null) {
    throw new Error(
        `Cannot find TensorFlow.js. If you are using a <script> tag, please ` +
        `also include @tensorflow/tfjs on the page before using this
        model.`);
  }

  const url = resNet50Checkpoint(outputStride, quantBytes);
  const graphModel = await tfconv.loadGraphModel(config.modelUrl || url);
  const resnet = new ResNet(graphModel, outputStride);
  return new BodyPix(resnet, config.inputResolution);
}

/**
 * Loads the BodyPix model instance from a checkpoint, with the ResNet
 * or MobileNet architecture. The model to be loaded is configurable using the
 * config dictionary ModelConfig. Please find more details in the
 * documentation of the ModelConfig.
 *
 * @param config ModelConfig dictionary that contains parameters for
 * the BodyPix loading process. Please find more details of each parameters
 * in the documentation of the ModelConfig interface. The predefined
 * `MOBILENET_V1_CONFIG` and `RESNET_CONFIG` can also be used as references
 * for defining your customized config.
 */
export async function load(config: ModelConfig = RESNET_CONFIG):
    Promise<BodyPix> {
  // config = validateModelConfig(config);
  if (config.architecture === 'ResNet50') {
    return loadResNet(config);
    // } else if (config.architecture === 'MobileNetV1') {
    //   return loadMobileNet(config);
  } else {
    return null;
  }
}
