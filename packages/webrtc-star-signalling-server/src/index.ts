import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { createSecureServer, Http2ServerResponse } from 'node:http2'
import Debug from 'debug'

const debug = Debug('server')

const rooms = new Map()

const sendEvent = (userId: string, data: string | Buffer, event?: string, id?: string) => {
  const ESstream = socketMap.get(userId)
  if (!ESstream) {
    console.warn('Tried to send event to disconnected user', userId)
    return
  }
  addTimeout(ESstream)
  let message = event ? `event:${event}\n` : ''
  message += `data:${JSON.stringify(data)}`
  if (id) {
    message += `\nid:${id}`
  }
  message += '\n\n'
  debug.extend(userId)('Sending %s %o', event ?? 'message', data)
  ESstream.write(message)
}

type ESstream = Http2ServerResponse & { pingTimeout: any, userId: string, rooms: Set<any> }

const addTimeout = (ESstream: ESstream) => {
  clearTimeout(ESstream.pingTimeout)
  ESstream.pingTimeout = setTimeout(() => {
    sendEvent(ESstream.userId, '', 'ping')
    addTimeout(ESstream)
  }, 5_000)
}

const socketMap = new Map()

const sseServer = createSecureServer({
  key: readFileSync('server.key'),
  cert: readFileSync('server.crt'),
}, (req, res: Http2ServerResponse | ESstream) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Request-Method': '*',
      'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
      'Access-Control-Allow-Headers': '*'
    })
    res.end()
    return
  }

  const pathQuery = req.url.split('?')

  const searchParams = new URLSearchParams(pathQuery[1])

  const userId: string = searchParams.get('uid')!
  if (['/events', '/message'].includes(pathQuery[0]) && (!userId)) {
    res.writeHead(401)
    res.end()
    return
  }

  const userDebug = userId ? debug.extend(userId) : debug

  switch (pathQuery[0]) {
    case '/events': {
      userDebug(`New stream ${userId}`)
      ;(res as ESstream).userId = userId
      ;(res as ESstream).rooms = new Set()
      socketMap.set(userId, res)

      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
        'Content-Type': 'text/event-stream'
      })
      sendEvent(userId, `WELCOME ${userId}`)

      res.on('close', () => {
        clearTimeout((res as ESstream).pingTimeout)
        ;(res as ESstream).rooms.forEach(roomId => {
          userDebug('Exiting room %s', roomId)
          const room = rooms.get(roomId)
          room.delete(userId)
          if (room.size === 0) {
            debug('Closing room %s', roomId)
            rooms.delete(room)
          }
        })
        socketMap.delete(userId)
        userDebug(`Closed`)
      })

      addTimeout(res as ESstream)
      break
    }
    case '/message': {
      const resEnd = (body: { error?: any }) => {
        // userDebug('Res', body)
        res.writeHead(body.error ? 400 : 200, {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify(body))
      }
      let body = Buffer.from([])
      req.on('data', (chunk: Buffer) => {
        body = Buffer.concat([body, chunk])
      })
      req.on('end', handleMessage)

      function handleMessage () {
        const parsedBody: { type: string, room: string, userId: string, otherUserId: string } = JSON.parse(body.toString('utf-8'))
        if (parsedBody.type) {
          switch (parsedBody.type) {
            case 'offer': {
              if (!parsedBody.room) {
                resEnd({ error: 'Must specify room' })
                break
              }
              let room
              if (!rooms.has(parsedBody.room)) {
                debug('Creating room', parsedBody.room)
                const newRoom = new Map()
                rooms.set(parsedBody.room, newRoom)
                room = newRoom
              } else {
                room = rooms.get(parsedBody.room)
              }
              if (room.size > 0) {
                userDebug('offers already in the room, sending one')
                for (const [userKey, userOffer] of room) {
                  if (!userOffer.offer) continue
                  room.set(userKey, {})
                  resEnd(userOffer.offer)
                  break
                }
              }
              room.set(userId, { offer: body })
              process.nextTick(() => {
                socketMap.get(userId).rooms.add(parsedBody.room)
              })
              break
            }
            case 'answer': {
              userDebug('sending answer for %s from %s', parsedBody.otherUserId, parsedBody.userId)
              if (!socketMap.has(parsedBody.otherUserId)) {
                userDebug({ error: 'Other user has already disconnected' })
              }
              sendEvent(parsedBody.otherUserId, body, 'answer')
              break
            }
          }
        }
        else {
          userDebug(parsedBody)
        }
        if (!res.writableEnded) {
          resEnd({})
        }
      }

      // sendEvent(userId, 'pong', pong)
      break
    }
    default: {
      res.writeHead(404)
      res.end('Not found')
    }
  }
})

sseServer.listen(8383, '127.0.0.1', () => {
  debug('listening %d', (sseServer.address()! as AddressInfo).port)
})
