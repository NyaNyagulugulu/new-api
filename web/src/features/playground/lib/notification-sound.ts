/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
export type CompletionSoundPlayer = {
  unlock: () => void
  play: () => void
  dispose: () => void
}

export function createCompletionSoundPlayer(): CompletionSoundPlayer {
  let context: AudioContext | null = null

  const getContext = () => {
    if (typeof window === 'undefined') return null
    if (!context) {
      const AudioContextConstructor = window.AudioContext
      if (!AudioContextConstructor) return null
      context = new AudioContextConstructor()
    }
    return context
  }

  return {
    unlock() {
      const audioContext = getContext()
      if (audioContext?.state === 'suspended') {
        void audioContext.resume()
      }
    },
    play() {
      const audioContext = getContext()
      if (!audioContext || audioContext.state !== 'running') return

      const start = audioContext.currentTime
      for (const [index, frequency] of [740, 988].entries()) {
        const oscillator = audioContext.createOscillator()
        const gain = audioContext.createGain()
        const noteStart = start + index * 0.09
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(frequency, noteStart)
        gain.gain.setValueAtTime(0.0001, noteStart)
        gain.gain.exponentialRampToValueAtTime(0.05, noteStart + 0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.11)
        oscillator.connect(gain)
        gain.connect(audioContext.destination)
        oscillator.start(noteStart)
        oscillator.stop(noteStart + 0.12)
      }
    },
    dispose() {
      if (context) {
        void context.close().catch(() => undefined)
        context = null
      }
    },
  }
}
