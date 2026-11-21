import { useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:4000';

/**
 * useSocket(docId, callbacks)
 *
 * Single Socket.io connection per docId mount.
 * Re-joins the room on every connect event — this covers both the
 * initial connection and any reconnects after a network blip.
 *
 * Returns { sendOp, sendCursor, sendAgentOp }
 */
export function useSocket(docId, { onInit, onOp, onCursor, onError, onAck } = {}) {
  const socketRef = useRef(null);

  // Keep callbacks in refs so socket listeners never capture stale closures
  const onInitRef   = useRef(onInit);
  const onOpRef     = useRef(onOp);
  const onCursorRef = useRef(onCursor);
  const onErrorRef  = useRef(onError);
  const onAckRef    = useRef(onAck);

  useEffect(() => { onInitRef.current   = onInit;   }, [onInit]);
  useEffect(() => { onOpRef.current     = onOp;     }, [onOp]);
  useEffect(() => { onCursorRef.current = onCursor; }, [onCursor]);
  useEffect(() => { onErrorRef.current  = onError;  }, [onError]);
  useEffect(() => { onAckRef.current    = onAck;    }, [onAck]);

  useEffect(() => {
    if (!docId) return;

    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    // 'connect' fires on initial connect AND after every successful reconnect.
    // Re-emitting join-doc on reconnect puts us back in the room and
    // triggers a fresh doc-init so stale content is replaced.
    socket.on('connect', () => {
      socket.emit('join-doc', { docId });
    });

    socket.on('doc-init',  (p) => onInitRef.current?.(p));
    socket.on('op',        (p) => onOpRef.current?.(p));
    socket.on('op-ack',    (p) => onAckRef.current?.(p));
    socket.on('cursor',    (p) => onCursorRef.current?.(p));
    socket.on('error',     (p) => onErrorRef.current?.(p));

    socket.on('disconnect', (reason) => {
      // If the server disconnected us (not a client-side close), show error
      if (reason !== 'io client disconnect') {
        onErrorRef.current?.({ message: `Disconnected: ${reason}. Reconnecting…` });
      }
    });

    socket.on('connect_error', (err) => {
      onErrorRef.current?.({ message: `Connection error: ${err.message}` });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [docId]);

  const sendOp = useCallback((op) => {
    socketRef.current?.emit('op', { docId, op });
  }, [docId]);

  const sendCursor = useCallback((clientId, position) => {
    socketRef.current?.emit('cursor', { docId, clientId, position });
  }, [docId]);

  const sendAgentOp = useCallback((op, baseVersion, secret) => {
    socketRef.current?.emit('agent-op', { docId, op, baseVersion, secret });
  }, [docId]);

  return { sendOp, sendCursor, sendAgentOp };
}
