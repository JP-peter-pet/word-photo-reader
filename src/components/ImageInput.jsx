import { useRef, useState } from 'react'
import Webcam from 'react-webcam'

export default function ImageInput({ onImageSet }) {
  const fileInputRef = useRef(null)
  const [showCamera, setShowCamera] = useState(false)
  const webcamRef = useRef(null)

  const handleUpload = (e) => {
    const file = e.target?.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    onImageSet(url)
    e.target.value = ''
  }

  const handleCameraCapture = () => {
    const src = webcamRef.current?.getScreenshot?.()
    if (src) {
      onImageSet(src)
      setShowCamera(false)
    }
  }

  if (showCamera) {
    return (
      <div style={{ marginBottom: '1rem' }}>
        <div className="previewWrap hasImage" style={{ marginBottom: '0.75rem' }}>
          <Webcam
            ref={webcamRef}
            audio={false}
            screenshotFormat="image/jpeg"
            videoConstraints={{ facingMode: 'environment' }}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
        <div className="buttonsRow">
          <button type="button" className="btn btnCamera" onClick={() => setShowCamera(false)}>
            Close
          </button>
          <button type="button" className="btn btnUpload" onClick={handleCameraCapture}>
            Capture
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hiddenInput"
        onChange={handleUpload}
      />
      <div className="buttonsRow">
        <button
          type="button"
          className="btn btnUpload"
          onClick={() => fileInputRef.current?.click()}
        >
          Upload Image
        </button>
        <button type="button" className="btn btnCamera" onClick={() => setShowCamera(true)}>
          Use Camera
        </button>
      </div>
    </>
  )
}
