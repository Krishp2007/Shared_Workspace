import { useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:4000';

/**
 * useSocket(docId, { onInit, onOp, onCursor, onError })
 *
 * Manages a single Socket.io connection per mount.
 * Returns { sendOp, sendCursor, sendAgentOp }
 *
 * The socket connects once and joins the room for `docId`.
 * Cleans up on unmount or when docId changes.
 */
export function useSocket(docId, { onInit, onOp, onCursor, onError } = {}) {
  const socketRef = useRef(null);

  // Keep callbacks in refs so event handlers never go stale
  const onInitRef    = useRef(onInit);
  const onOpRef      = useRef(onOp);
  const onCursorRef  = useRef(onCursor);
  const onErrorRef   = useRef(onError);

  useEffect(() => { onInitRef.current   = onInit;   }, [onInit]);
  useEffect(() => { onOpRef.current     = onOp;     }, [onOp]);
  useEffect(() => { onCursorRef.current = onCursor; }, [onCursor]);
  useEffect(() => { onErrorRef.current  = onError;  }, [onError]);

  useEffect(() => {
    if (!docId) return;

    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-doc', { docId });
    });

    socket.on('doc-init', (payload) => onInitRef.current?.(payload));
    socket.on('op',       (payload) => onOpRef.current?.(payload));
    socket.on('cursor',   (payload) => onCursorRef.current?.(payload));
    socket.on('error',    (payload) => onErrorRef.current?.(payload));

    socket.on('connect_error', (err) => {
      onErrorRef.current?.({ message: `Connection failed: ${err.message}` });
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
