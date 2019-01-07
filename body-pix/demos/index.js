/**
 * @license
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */
import * as bodyPix from '@tensorflow-models/body-pix';
import dat from 'dat.gui';

import * as partColorScales from './part_color_scales';

const images =
    {
      baseballMotion:
          'http://farm3.staticflickr.com/2500/3675457529_c1371c610e_z.jpg',
      withLaptop:
          'http://farm4.staticflickr.com/3573/3437402322_3a8f176133_z.jpg',
      umbrella:
          'http://farm9.staticflickr.com/8214/8298673953_d574eb4434_z.jpg',
      umbrellaTwo:
          'http://farm9.staticflickr.com/8479/8236713500_79db43fcf2_z.jpg',
      surfingBehind:
          'http://farm8.staticflickr.com/7275/7450203376_1fafd8474f_z.jpg',
      sittingOnPhone:
          'http://farm1.staticflickr.com/37/84822178_7397727bec_z.jpg',
      ['readyToReturnServe (broken)']:
          'http://farm9.staticflickr.com/8172/8061507654_23d3e4ea06_z.jpg',
      skiing: 'http://farm3.staticflickr.com/2458/5725014603_10a79f1524_z.jpg',
      ['pitching (broken)']:
          'http://farm9.staticflickr.com/8153/7464259908_348c02ae65_z.jpg',
      withSuitcases:
          'http://farm3.staticflickr.com/2106/2243101628_d1a74995f7_z.jpg',
      readingBook:
          'http://farm3.staticflickr.com/2258/2155971166_04138f4aa7_z.jpg',
      atDesk: 'http://farm5.staticflickr.com/4061/4345218494_11b02485b0_z.jpg',
      ['girlWithUmbrella (broken)']:
          'http://farm5.staticflickr.com/4110/4976101457_b80e3f622f_z.jpg',
      ['snowboard (broken)']:
          'http://farm3.staticflickr.com/2391/2246945374_d43dfcc9d9_z.jpg',
      onBed: 'http://farm9.staticflickr.com/8438/7841132664_919c631e25_z.jpg',
      christmas:
          'http://farm5.staticflickr.com/4014/4277437993_1bd1ebba63_z.jpg',
      withUmbrellaThree:
          'http://farm7.staticflickr.com/6138/5945730369_7c9b5ca5e8_z.jpg',
      kidTie: 'http://farm7.staticflickr.com/6181/6118050001_d54d9a5e54_z.jpg',
      withBananas:
          'http://farm5.staticflickr.com/4063/4659589849_6e3d6250cd_z.jpg',
      servingTennis:
          'http://farm7.staticflickr.com/6088/6090810348_ac5eda47c9_z.jpg',
      ['manWithTie (broken)']:
          'http://farm4.staticflickr.com/3661/3437183240_4884303133_z.jpg',
      youngLady:
          'http://farm9.staticflickr.com/8370/8542870706_88249cc144_z.jpg',
      inRoom: 'http://farm8.staticflickr.com/7055/6878903138_cc2a4a8aa6_z.jpg',
      ['lookingAtPhone (broken)']:
          'http://farm6.staticflickr.com/5026/5841917549_2e65fcee79_z.jpg'
    }

function
isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function
isiOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function
isMobile() {
  return isAndroid() || isiOS();
}

function
isSafari() {
  return (/^((?!chrome|android).)*safari/i.test(navigator.userAgent));
}

const guiState = {
  image: images.baseballMotion,
  estimate: 'segmentation',
  input: {mobileNetArchitecture: '1.00', outputStride: 8},
  segmentation: {
    segmentationThreshold: 0.5,
    effect: 'mask',
    opacity: 0.7,
    backgroundBlurAmount: 3,
    maskBlurAmount: 0,
    // on safari, blurring happens on the cpu, thus reducing performance, so
    // default to turning this off for safari
    edgeBlurAmount: isSafari() ? 0 : 3
  },
  partMap: {colorScale: 'warm', segmentationThreshold: 0.5},
  net: null,
};

// const imageBucket =
//     'https://storage.googleapis.com/tfjs-models/assets/posenet/';

async function loadImage(imagePath) {
  const image = new Image();
  const promise = new Promise((resolve, reject) => {
    image.crossOrigin = '';
    image.onload = () => {
      resolve(image);
    };
  });

  image.src = imagePath;
  return promise;
}

/**
 * Sets up dat.gui controller on the top-right of the window
 */
function setupGui(cameras, net) {
  guiState.net = net;

  if (cameras.length > 0) {
    guiState.camera = cameras[0].deviceId;
  }

  const gui = new dat.GUI({width: 300});

  gui.add(guiState, 'image', images).onChange(estimateSegmentation);

  // Architecture: there are a few BodyPix models varying in size and
  // accuracy. 1.00 is the largest, but will be the slowest. 0.50 is the
  // fastest, but least accurate.
  const architectureController = gui.add(
      guiState.input, 'mobileNetArchitecture',
      ['1.00', '0.75', '0.50', '0.25']);
  // Output stride:  Internally, this parameter affects the height and
  // width of the layers in the neural network. The lower the value of the
  // output stride the higher the accuracy but slower the speed, the
  // higher the value the faster the speed but lower the accuracy.
  gui.add(guiState.input, 'outputStride', [8, 16, 32])
      .onChange(estimateSegmentation);

  const estimateController =
      gui.add(guiState, 'estimate', ['segmentation', 'partmap']);

  let segmentation = gui.addFolder('Segmentation');
  segmentation.add(guiState.segmentation, 'segmentationThreshold', 0.0, 1.0)
      .onChange(estimateSegmentation);
  const segmentationEffectController =
      segmentation.add(guiState.segmentation, 'effect', ['mask', 'bokeh']);

  segmentation.open();

  let darknessLevel;
  let bokehBlurAmount;
  let edgeBlurAmount;
  let maskBlurAmount;

  segmentationEffectController.onChange(function(effectType) {
    if (effectType === 'mask') {
      if (bokehBlurAmount) {
        bokehBlurAmount.remove();
      }
      if (maskBlurAmount) {
        maskBlurAmount.remove();
      }
      darknessLevel =
          segmentation.add(guiState.segmentation, 'opacity', 0.0, 1.0)
              .onChange(estimateSegmentation);
      maskBlurAmount = segmentation.add(guiState.segmentation, 'maskBlurAmount')
                           .min(0)
                           .max(20)
                           .step(1)
                           .onChange(estimateSegmentation);
    } else if (effectType === 'bokeh') {
      if (darknessLevel) {
        darknessLevel.remove();
      }
      if (maskBlurAmount) {
        maskBlurAmount.remove();
      }
      bokehBlurAmount = segmentation
                            .add(
                                guiState.segmentation,
                                'backgroundBlurAmount',
                                )
                            .min(1)
                            .max(20)
                            .step(1)
                            .onChange(estimateSegmentation);
      edgeBlurAmount = segmentation.add(guiState.segmentation, 'edgeBlurAmount')
                           .min(0)
                           .max(20)
                           .step(1)
                           .onChange(estimateSegmentation);
    }

    estimateSegmentation();
  });

  // set the mask value in the segmentation effect so that the options are
  // shown.
  segmentationEffectController.setValue(guiState.segmentation.effect);

  let partMap = gui.addFolder('Part Map');
  partMap.add(guiState.partMap, 'segmentationThreshold', 0.0, 1.0)
      .onChange(estimateSegmentation);
  partMap.add(guiState.partMap, 'colorScale', Object.keys(partColorScales))
      .onChange(estimateSegmentation);

  architectureController.onChange(async architecture => {
    // Important to purge variables and free up GPU memory
    guiState.net.dispose();

    // Load the BodyPix model weights for either the 0.25, 0.50, 0.75,
    // or 1.00 version
    guiState.net = await bodyPix.load(+architecture);

    estimateSegmentation();
  });

  estimateController.onChange(function(estimationType) {
    if (estimationType === 'segmentation') {
      segmentation.open();
      partMap.close();
    } else {
      segmentation.close();
      partMap.open();
    }
    estimateSegmentation();
  });
}

/**
 * Feeds an image to BodyPix to estimate segmentation - this is where the
 * magic happens.
 */
async function estimateSegmentation() {
  const canvas = document.getElementById('output');

  const image = await loadImage(guiState.image);

  const outputStride = +guiState.input.outputStride;

  const flipHorizontal = false;

  switch (guiState.estimate) {
    case 'segmentation':
      const personSegmentation = await guiState.net.estimatePersonSegmentation(
          image, flipHorizontal, outputStride,
          guiState.segmentation.segmentationThreshold);

      switch (guiState.segmentation.effect) {
        case 'mask':
          const invert = true;
          const backgroundDarkeningMask =
              bodyPix.toMaskImageData(personSegmentation, invert);
          bodyPix.drawMask(
              canvas, image, backgroundDarkeningMask,
              guiState.segmentation.opacity,
              guiState.segmentation.maskBlurAmount, flipHorizontal);

          break;
        case 'bokeh':
          bodyPix.drawBokehEffect(
              canvas, image, personSegmentation,
              +guiState.segmentation.backgroundBlurAmount,
              guiState.segmentation.edgeBlurAmount, flipHorizontal);
          break;
      }
      break;
    case 'partmap':
      const partSegmentation = await guiState.net.estimatePartSegmentation(
          image, flipHorizontal, outputStride,
          guiState.partMap.segmentationThreshold);

      const coloredPartImageOpacity = 0.7;
      const coloredPartImageData = bodyPix.toColoredPartImageData(
          partSegmentation, partColorScales[guiState.partMap.colorScale]);

      bodyPix.drawMask(
          canvas, image, coloredPartImageData, coloredPartImageOpacity, 0,
          flipHorizontal);

      break;
    default:
      break;
  }
}

/**
 * Kicks off the demo.
 */
export async function bindPage() {
  // Load the BodyPix model weights with architecture 0.75
  const net = await bodyPix.load(+guiState.input.mobileNetArchitecture);

  document.getElementById('loading').style.display = 'none';
  document.getElementById('main').style.display = 'block';

  setupGui([], net);

  await estimateSegmentation();
}

navigator.getUserMedia = navigator.getUserMedia ||
    navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
// kick off the demo
bindPage();
