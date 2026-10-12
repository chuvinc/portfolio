import cvPromise from '@techstark/opencv-js'

export async function inpaintImage(image, maskCanvas) {
  const opencv = await Promise.resolve(cvPromise)

  if (!opencv.Mat || !opencv.inpaint) {
    throw new Error('OpenCV is not ready for inpainting.')
  }

  const width = maskCanvas.width
  const height = maskCanvas.height

  // Create a canvas containing the original image.
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = width
  sourceCanvas.height = height

  const sourceContext = sourceCanvas.getContext('2d')

  if (!sourceContext) {
    throw new Error('Could not create image canvas.')
  }

  sourceContext.drawImage(image, 0, 0, width, height)

  let source = null
  let rgb = null
  let mask = null
  let result = null
  let resultRgba = null

  try {
    // Convert the original image into OpenCV format.
    source = opencv.imread(sourceCanvas)

    rgb = new opencv.Mat()
    opencv.cvtColor(source, rgb, opencv.COLOR_RGBA2RGB)

    // Convert the editable cleanup mask into a
    // single-channel black-and-white OpenCV mask.
    mask = new opencv.Mat(height, width, opencv.CV_8UC1)

    const maskContext = maskCanvas.getContext('2d', {
        willReadFrequently: true,
    })

    if (!maskContext) {
      throw new Error('Could not read cleanup mask.')
    }

    const maskPixels = maskContext.getImageData(
      0,
      0,
      width,
      height
    ).data

    for (let i = 0; i < width * height; i++) {
      mask.data[i] = maskPixels[i * 4] > 127 ? 255 : 0
    }

    // Remove selected pixels and reconstruct the
    // background using OpenCV's Telea algorithm.
    result = new opencv.Mat()

    opencv.inpaint(
      rgb,
      mask,
      result,
      3,
      opencv.INPAINT_TELEA
    )

    // Convert the result back into RGBA format.
    resultRgba = new opencv.Mat()

    opencv.cvtColor(
      result,
      resultRgba,
      opencv.COLOR_RGB2RGBA
    )

    // Create a canvas containing the cleaned image.
    const outputCanvas = document.createElement('canvas')

    opencv.imshow(outputCanvas, resultRgba)

    return outputCanvas
  } finally {
    // Free OpenCV's WebAssembly memory.
    source?.delete()
    rgb?.delete()
    mask?.delete()
    result?.delete()
    resultRgba?.delete()
  }
}
