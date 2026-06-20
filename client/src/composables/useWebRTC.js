import { ref } from 'vue';
import { useSocket, sendSignal } from './useSocket';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

export function useWebRTC() {
  const socket = useSocket();
  const isConnected = ref(false);
  const onMessageCallbacks = [];
  const onConnectionChangeCallbacks = [];

  let peerConnection = null;
  let dataChannel = null;
  let currentPeerId = null;
  let isInitiator = false;
  let iceCandidateQueue = [];
  let signalHandler = null;

  function createPeerConnection() {
    if (peerConnection) {
      try {
        peerConnection.close();
      } catch (e) {}
    }

    peerConnection = new RTCPeerConnection(RTC_CONFIG);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && currentPeerId) {
        sendSignal(currentPeerId, {
          type: 'ice-candidate',
          candidate: event.candidate
        });
      }
    };

    peerConnection.ondatachannel = (event) => {
      console.log('[WebRTC] Received data channel');
      dataChannel = event.channel;
      setupDataChannel();
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      console.log('[WebRTC] Connection state:', state);
      if (state === 'connected') {
        isConnected.value = true;
        onConnectionChangeCallbacks.forEach((cb) => cb(true));
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        isConnected.value = false;
        onConnectionChangeCallbacks.forEach((cb) => cb(false));
      }
    };

    return peerConnection;
  }

  function setupDataChannel() {
    if (!dataChannel) return;

    dataChannel.onopen = () => {
      console.log('[WebRTC] Data channel opened');
      isConnected.value = true;
      onConnectionChangeCallbacks.forEach((cb) => cb(true));
    };

    dataChannel.onclose = () => {
      console.log('[WebRTC] Data channel closed');
      isConnected.value = false;
      onConnectionChangeCallbacks.forEach((cb) => cb(false));
    };

    dataChannel.onerror = (error) => {
      console.error('[WebRTC] Data channel error:', error);
    };

    dataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        onMessageCallbacks.forEach((cb) => cb(message));
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };
  }

  async function flushIceCandidates() {
    if (!peerConnection || !peerConnection.remoteDescription) return;
    while (iceCandidateQueue.length > 0) {
      const candidate = iceCandidateQueue.shift();
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('[WebRTC] Error adding queued ICE candidate:', e);
      }
    }
  }

  async function createOffer() {
    if (!peerConnection) {
      createPeerConnection();
    }

    try {
      console.log('[WebRTC] Creating offer as initiator');
      dataChannel = peerConnection.createDataChannel('burn-channel');
      setupDataChannel();

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      if (currentPeerId) {
        console.log('[WebRTC] Sending offer to peer');
        sendSignal(currentPeerId, {
          type: 'offer',
          sdp: offer
        });
      }
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  }

  async function handleSignal(data) {
    if (!peerConnection) {
      createPeerConnection();
    }

    try {
      if (data.type === 'offer') {
        console.log('[WebRTC] Received offer');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        if (currentPeerId) {
          console.log('[WebRTC] Sending answer');
          sendSignal(currentPeerId, {
            type: 'answer',
            sdp: answer
          });
        }
        await flushIceCandidates();
      } else if (data.type === 'answer') {
        console.log('[WebRTC] Received answer');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await flushIceCandidates();
      } else if (data.type === 'ice-candidate' && data.candidate) {
        if (peerConnection.remoteDescription) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else {
          console.log('[WebRTC] Queuing ICE candidate');
          iceCandidateQueue.push(data.candidate);
        }
      }
    } catch (error) {
      console.error('Error handling signal:', error);
    }
  }

  function setPeerId(peerId, initiator) {
    currentPeerId = peerId;
    isInitiator = initiator;
    iceCandidateQueue = [];

    if (!signalHandler) {
      signalHandler = ({ from, data }) => {
        if (from === currentPeerId) {
          handleSignal(data);
        }
      };
      socket.on('signal', signalHandler);
    }

    if (initiator) {
      createOffer();
    }
  }

  function sendMessage(message) {
    if (dataChannel && dataChannel.readyState === 'open') {
      try {
        dataChannel.send(JSON.stringify(message));
        return true;
      } catch (e) {
        console.error('[WebRTC] Failed to send message:', e);
        return false;
      }
    }
    return false;
  }

  function onMessage(callback) {
    onMessageCallbacks.push(callback);
    return () => {
      const index = onMessageCallbacks.indexOf(callback);
      if (index > -1) {
        onMessageCallbacks.splice(index, 1);
      }
    };
  }

  function onConnectionChange(callback) {
    onConnectionChangeCallbacks.push(callback);
    return () => {
      const index = onConnectionChangeCallbacks.indexOf(callback);
      if (index > -1) {
        onConnectionChangeCallbacks.splice(index, 1);
      }
    };
  }

  function cleanup() {
    if (signalHandler) {
      socket.off('signal', signalHandler);
      signalHandler = null;
    }

    if (dataChannel) {
      try {
        dataChannel.close();
      } catch (e) {}
      dataChannel = null;
    }

    if (peerConnection) {
      try {
        peerConnection.close();
      } catch (e) {}
      peerConnection = null;
    }

    isConnected.value = false;
    currentPeerId = null;
    isInitiator = false;
    iceCandidateQueue = [];
    onMessageCallbacks.length = 0;
    onConnectionChangeCallbacks.length = 0;
  }

  return {
    isConnected,
    setPeerId,
    sendMessage,
    onMessage,
    onConnectionChange,
    cleanup
  };
}
