type OverlayState = 'hidden' | 'showing' | 'fading'
type ToastShowPayload = { text: string }

type OverlayApi = {
  onToastShow: (listener: (payload: ToastShowPayload) => void) => void
  toastShow: (text: string) => void
}

type OverlayWindow = Window & { overlay?: OverlayApi }

const bubble = document.getElementById('bubble')
const overlayWindow = window as OverlayWindow

if (!bubble) {
  throw new Error('overlay bubble element not found')
}

let state: OverlayState = 'hidden'
let hideTimer: ReturnType<typeof setTimeout> | null = null

function clearHideTimer(): void {
  if (!hideTimer) {
    return
  }
  clearTimeout(hideTimer)
  hideTimer = null
}

function hideImmediately(): void {
  clearHideTimer()
  bubble.classList.remove('is-visible', 'is-fading')
  bubble.classList.add('is-hidden')
  state = 'hidden'
}

function startFade(): void {
  if (state === 'hidden') {
    return
  }

  bubble.classList.remove('is-visible', 'is-hidden')
  bubble.classList.add('is-fading')
  state = 'fading'
}

function show(text: string): void {
  bubble.textContent = text
  bubble.classList.remove('is-hidden', 'is-fading')
  bubble.classList.add('is-visible')
  state = 'showing'

  clearHideTimer()
  hideTimer = setTimeout(() => {
    startFade()
  }, 3000)
}

bubble.addEventListener('transitionend', (event: TransitionEvent) => {
  if (event.propertyName !== 'opacity') {
    return
  }
  if (state !== 'fading') {
    return
  }
  hideImmediately()
})

hideImmediately()

function bindOverlayApi(retries = 40): void {
  const overlayApi = overlayWindow.overlay
  if (!overlayApi) {
    if (retries > 0) {
      setTimeout(() => {
        bindOverlayApi(retries - 1)
      }, 50)
    }
    return
  }

  overlayApi.onToastShow(({ text }) => {
    show(text)
  })
}

bindOverlayApi()
