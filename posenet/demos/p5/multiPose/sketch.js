var width = 600;
var height = 600;
var videoSize = 600;

// the size of the neural network model to load. Must be 0.50, 0.75, 1.00, or 1.01
// The higher the number, the larger the model and the more accurate it is, but
// the slower the speed. 0.50 is recommended for mobile.
var modelSize = 0.75;

// A number between 0.2 and 1.0. How much posenet should scale the image by before feeding
// it through the network.  Set this number lower to scale down the image and increase
// the speed at the cost of accuracy.
var imageScaleFactor = 0.75;

// A value between 0.0 and 1.0 - the minimum confidence level a pose must have to
// show it. Raise this number to filter out lower confidence poses
var minPoseConfidence = 0.3;

// the minimum score of keypoints from posenet to show.
// Should be between 0.0 and 1.0. Use this to filter out
// lower accuracy parts
var minPartConfidence = 0.3;

// number between 0.2 and 1.0. What to scale the image by before
// feeding it through the network.  Set this number lower to scale down the image and
// increase the speed when feeding through the network at the cost of accuracy.
var imageScaleFactor = 0.5;

// if the pose results should be flipped horizontally. Useful for webcam videos.
var flipHorizontal = false;

// must be 8 or 16.  The higher this number the faster the speed and lower the accuracy.
// 16 is a good default value.  Switch to 8 if higher accuracy is desired.
var outputStride = 16;

// The maximum number of poses to detect
var maxPoseDetections = 10;

var capture;
var net;

var poses = [];

function estimatePoses() {
  // call posenet to estimate a pose
  net.estimateMultiplePoses(capture.elt, 0.5, flipHorizontal, outputStride, maxPoseDetections)
    .then(function(estimatedPoses) {
      // store the poses to draw them below
      poses = estimatedPoses;
      // next animation loop, call posenet again to estimate poses
      requestAnimationFrame(function() {
        estimatePoses();
      });
    });
}

function setup() {
  createCanvas(600, 600);
  // create video capture.  For PoseNet, videos must be square
  capture = createCapture({
    video: {
      width: videoSize,
      height: videoSize
    }
  });
  capture.size(videoSize, videoSize);
  capture.hide();

  // load posenet by downloading the weights for the model.
  posenet.load(modelSize).then(function(loadedNet) {
    net = loadedNet;
    // when it's loaded, start estimating poses
    requestAnimationFrame(function() {
      estimatePoses();
    });
  })
}

function draw() {
  background(255);
  image(capture, 0, 0, videoSize, videoSize);

  noStroke();
  // iterate through poses, drawing the keypoints and skeletons
  for(var i = 0; i < poses.length; i++) {
    var pose = poses[i];
    // filter out poses that do not meet the minimum pose confidence.
    if (pose.score >= minPoseConfidence) {
      var keypoints = pose.keypoints;
      // draw keypoints
      for(var j = 0; j < keypoints.length; j++) {
        var keypoint = keypoints[j];
        // filter out keypoints that have a low confidence
        if (keypoint.score > minPartConfidence) {
          // for wrists, make the part cyan
          if (j == posenet.partIds['leftWrist'] || j == posenet.partIds['rightWrist'])
            fill(0, 255, 255);
          // all other parts are yellow
          else
            fill(255, 255, 0);

          ellipse(keypoint.position.x, keypoint.position.y, 10, 10,);
        }
      }

      // get skeleton, filtering out parts wtihout
      // a high enough confidence level
      if (keypoints.length > 0) {
        stroke(255, 255, 0);
        var skeleton = posenet.getAdjacentKeyPoints(keypoints, minPartConfidence);
        for(var j = 0; j < skeleton.length; j++) {
          // draw each line in the skeleton
          var segment = skeleton[j];
          line(
            segment[0].position.x, segment[0].position.y,
            segment[1].position.x, segment[1].position.y
          );
        }
      }
    }
  }
}
