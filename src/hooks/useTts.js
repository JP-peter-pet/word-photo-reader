import { useState, useCallback, useRef } from 'react'

const LANG = 'en-US'

function getEnglishVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? []
  const en = voices.find((v) => v.lang === 'en-US' || v.lang.startsWith('en'))
  return en || voices[0]
}

export function useTts({ repeatCount = 5, delayMs = 2000 }) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const queueRef = useRef([])
  const timeoutRef = useRef(null)

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel()
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    queueRef.current = []
    setIsSpeaking(false)
  }, [])

  const speakOnce = useCallback((word, onEnd) => {
    if (!word || !window.speechSynthesis) {
      onEnd?.()
      return
    }
    const u = new SpeechSynthesisUtterance(String(word).trim())
    u.lang = LANG
    u.rate = 1
    const voice = getEnglishVoice()
    if (voice) u.voice = voice
    u.onend = () => onEnd?.()
    u.onerror = () => onEnd?.()
    window.speechSynthesis.speak(u)
  }, [])

  const speakWord = useCallback(
    (word) => {
      stopSpeaking()
      const w = String(word).trim()
      if (!w) return
      setIsSpeaking(true)
      let count = 0

      const next = () => {
        count += 1
        if (count > repeatCount) {
          setIsSpeaking(false)
          return
        }
        speakOnce(w, () => {
          if (count < repeatCount) {
            timeoutRef.current = setTimeout(next, delayMs)
          } else {
            setIsSpeaking(false)
          }
        })
      }
      next()
    },
    [repeatCount, delayMs, speakOnce, stopSpeaking]
  )

  return { speakWord, stopSpeaking, isSpeaking }
}
