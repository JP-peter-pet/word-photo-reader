import { useState, useCallback, useRef, useEffect } from 'react'

const LANG = 'en-US'

/** 크롬 여부 (resume 주기 호출은 Safari/iOS용, 크롬에서는 끄기) */
function isChrome() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Chrome|Chromium/.test(ua) && !/Edg|OPR|Samsung Browser|FxiOS/.test(ua)
}

/** en-US 우선, 품질 좋은 음성(Google/Microsoft/Apple 기본) 우선 선택 */
function getEnglishVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? []
  const en = voices.filter((v) => v.lang === 'en-US' || v.lang.startsWith('en-'))
  if (!en.length) return voices.find((v) => v.lang.startsWith('en')) || voices[0]
  const name = (v) => (v.name || '').toLowerCase()
  const preferred = en.find((v) => name(v).includes('google') || name(v).includes('samantha') || name(v).includes('alex') || name(v).includes('daniel'))
  if (preferred) return preferred
  const defaultEn = en.find((v) => v.default)
  if (defaultEn) return defaultEn
  return en[0]
}

export function useTts({ repeatCountShort = 3, repeatCountLong = 5, lengthThreshold = 5, delayMs = 2000 }) {
  const getRepeatCount = useCallback(
    (word) => (String(word).trim().length < lengthThreshold ? repeatCountShort : repeatCountLong),
    [repeatCountShort, repeatCountLong, lengthThreshold]
  )
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [currentWord, setCurrentWord] = useState(null)
  const queueRef = useRef([])
  const timeoutRef = useRef(null)
  const intervalRef = useRef(null)
  const voicesReadyRef = useRef(false)
  const runIdRef = useRef(0)
  const utteranceRef = useRef(null)

  const [speechSupported, setSpeechSupported] = useState(() => typeof window !== 'undefined' && !!window.speechSynthesis)

  useEffect(() => {
    const syn = window.speechSynthesis
    setSpeechSupported(!!syn)
    if (!syn) return
    const onVoicesChanged = () => { voicesReadyRef.current = true }
    if (syn.getVoices().length > 0) voicesReadyRef.current = true
    syn.addEventListener('voiceschanged', onVoicesChanged)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && typeof syn.resume === 'function' && syn.paused) syn.resume()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      syn.removeEventListener('voiceschanged', onVoicesChanged)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const stopSpeaking = useCallback(() => {
    runIdRef.current += 1
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    try {
      window.speechSynthesis?.cancel()
    } catch (_) {}
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    utteranceRef.current = null
    queueRef.current = []
    setIsSpeaking(false)
    setCurrentWord(null)
  }, [])

  const SAFETY_MS = isChrome() ? 3500 : 5000
  const RESUME_INTERVAL_MS = 1400
  const AFTER_PRIME_MS = isChrome() ? 50 : 30

  /** 모든 브라우저: 사용자 제스처와 같은 틱에서 첫 speak() 호출 (Chrome/iOS 정책). 빈 발화로 엔진 활성화. */
  const PRIME_SAFETY_MS = 600
  const primeSync = useCallback((onEnd) => {
    const syn = window.speechSynthesis
    if (!syn) {
      onEnd?.()
      return
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      if (tid) clearTimeout(tid)
      onEnd?.()
    }
    let tid = setTimeout(finish, PRIME_SAFETY_MS)
    try {
      const u = new SpeechSynthesisUtterance('\u00A0')
      if (typeof u.volume !== 'undefined') u.volume = 0.01
      u.rate = 2
      u.lang = LANG
      u.onend = finish
      u.onerror = finish
      syn.speak(u)
    } catch (_) {
      finish()
    }
  }, [])

  const speakOnce = useCallback((word, onEnd) => {
    if (!word || !window.speechSynthesis) {
      onEnd?.()
      return
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      utteranceRef.current = null
      if (safetyId) clearTimeout(safetyId)
      onEnd?.()
    }
    const text = String(word).trim() + '\u00A0'
    const u = new SpeechSynthesisUtterance(text)
    utteranceRef.current = u
    u.lang = LANG
    u.rate = 0.85
    u.pitch = 1
    const voice = getEnglishVoice()
    if (voice) u.voice = voice
    u.onend = finish
    u.onerror = finish
    const safetyId = setTimeout(finish, SAFETY_MS)
    window.speechSynthesis.speak(u)
  }, [])

  /** 한 단어를 N번 재생. 한 번에 하나씩만 재생해 메모리 사용 최소화. 정지 시 runId 불일치로 체인 중단. */
  const speakWordRepeats = useCallback((word, repeatCount, onAllEnd, runIdRefArg, currentRunId) => {
    if (!word || repeatCount < 1) {
      onAllEnd?.()
      return
    }
    const ref = runIdRefArg ?? runIdRef
    const myRunId = currentRunId ?? runIdRef.current
    let count = 0
    const next = () => {
      if (ref.current !== myRunId) {
        onAllEnd?.()
        return
      }
      count += 1
      if (count > repeatCount) {
        onAllEnd?.()
        return
      }
      speakOnce(word, next)
    }
    next()
  }, [speakOnce])

  const speakWord = useCallback(
    (word) => {
      const w = String(word).trim()
      if (!w) return
      if (isSpeaking) {
        stopSpeaking()
        runIdRef.current += 1
      } else {
        runIdRef.current += 1
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
      const myRunId = runIdRef.current
      const repeatCount = getRepeatCount(w)
      setCurrentWord(w)
      setIsSpeaking(true)
      const syn = window.speechSynthesis
      const useResumeInterval = syn && !isChrome() && !intervalRef.current
      if (useResumeInterval) {
        intervalRef.current = setInterval(() => {
          if (syn.paused && typeof syn.resume === 'function') syn.resume()
        }, RESUME_INTERVAL_MS)
      }
      const onDone = () => {
        if (myRunId !== runIdRef.current) return
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
        setIsSpeaking(false)
        setCurrentWord(null)
      }
      primeSync(() => {
        if (myRunId !== runIdRef.current) return
        speakWordRepeats(w, repeatCount, onDone, runIdRef, myRunId)
      })
    },
    [speakWordRepeats, stopSpeaking, primeSync, isSpeaking, getRepeatCount]
  )

  const LIST_DELAY_MS = 1200
  /** 5분 가까이 끊기지 않도록 세션 갱신을 자주 함 (브라우저 제한은 우리가 설정 불가) */
  const RE_PRIME_EVERY_WORDS = 2

  const speakWordList = useCallback(
    (wordList) => {
      if (!wordList?.length || !window.speechSynthesis) return
      if (isSpeaking) {
        stopSpeaking()
        runIdRef.current += 1
      } else {
        runIdRef.current += 1
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
      const myRunId = runIdRef.current
      const list = wordList
      setIsSpeaking(true)
      const syn = window.speechSynthesis
      const useResumeInterval = syn && !isChrome() && !intervalRef.current
      if (useResumeInterval) {
        intervalRef.current = setInterval(() => {
          if (syn.paused && typeof syn.resume === 'function') syn.resume()
        }, RESUME_INTERVAL_MS)
      }
      let wordIndex = 0
      let repeatIndex = 0
      const next = () => {
        if (myRunId !== runIdRef.current) return
        if (wordIndex >= list.length) {
          if (myRunId === runIdRef.current) {
            if (intervalRef.current) {
              clearInterval(intervalRef.current)
              intervalRef.current = null
            }
            setIsSpeaking(false)
            setCurrentWord(null)
          }
          return
        }
        const w = String(list[wordIndex]).trim()
        if (!w) {
          wordIndex += 1
          repeatIndex = 0
          timeoutRef.current = setTimeout(next, 300)
          return
        }
        if (myRunId !== runIdRef.current) return
        setCurrentWord(w)
        const repeatCount = getRepeatCount(w)
        const doSpeak = () => {
          speakWordRepeats(w, repeatCount, () => {
            if (myRunId !== runIdRef.current) return
            wordIndex += 1
            repeatIndex = 0
            timeoutRef.current = setTimeout(next, LIST_DELAY_MS)
          }, runIdRef, myRunId)
        }
        const needRePrime = RE_PRIME_EVERY_WORDS > 0 && wordIndex > 0 && wordIndex % RE_PRIME_EVERY_WORDS === 0
        if (needRePrime) {
          primeSync(() => {
            if (myRunId !== runIdRef.current) return
            timeoutRef.current = setTimeout(doSpeak, 80)
          })
        } else {
          doSpeak()
        }
      }
      primeSync(() => {
        if (myRunId !== runIdRef.current) return
        timeoutRef.current = setTimeout(next, AFTER_PRIME_MS)
      })
    },
    [speakWordRepeats, stopSpeaking, delayMs, primeSync, isSpeaking, getRepeatCount]
  )

  return { speakWord, speakWordList, stopSpeaking, isSpeaking, currentWord, speechSupported }
}
