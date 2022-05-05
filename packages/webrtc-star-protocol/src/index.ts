export interface OfferSignal {
  type: 'offer'
  sdp: string
}

export interface AnswerSignal {
  type: 'answer'
  sdp: string
}

export interface CandidateSignal {
  type: 'candidate'
  candidate: {
    candidate: string
    sdpMLineIndex?: number
    sdpMid?: string
  }
}

export interface RenegotiateSignal {
  type: 'renegotiate'
}

export interface GoodbyeSignal {
  type: 'goodbye'
}

export type Signal = OfferSignal | AnswerSignal | CandidateSignal | RenegotiateSignal | GoodbyeSignal

export interface HandshakeSignal {
  srcMultiaddr: string
  dstMultiaddr: string
  intentId: string
  signal: Signal
  answer?: boolean
  err?: string
}

export interface SocketEvents {
  'ss-handshake': (offer: HandshakeSignal) => void
  'ws-peer': (maStr: string) => void
  'ws-handshake': (offer: HandshakeSignal) => void
  'error': (err: Error) => void
  'listening': () => void
  'close': () => void
}

export interface WebRTCMulttiSocket extends EventSource {
  emit: (event: string, message: string | any) => void
  on: (event: string, fn: (data: any) => void) => void
}
