<template>
  <div class="app-container">
    <header class="app-header">
      <div class="logo">🔥</div>
      <h1>阅后即焚</h1>
      <p class="subtitle">WebRTC 加密文本传输 · P2P直连</p>
    </header>

    <main class="app-main">
      <div v-if="!inRoom" class="room-entry">
        <div class="entry-card">
          <div class="entry-tabs">
            <button
              class="tab-btn"
              :class="{ active: entryMode === 'create' }"
              @click="entryMode = 'create'"
            >
              创建房间
            </button>
            <button
              class="tab-btn"
              :class="{ active: entryMode === 'join' }"
              @click="entryMode = 'join'"
            >
              加入房间
            </button>
          </div>

          <div v-if="entryMode === 'create'" class="entry-form">
            <p class="entry-desc">点击创建，获取4位房间号分享给对方</p>
            <button class="primary-btn" @click="handleCreateRoom" :disabled="loading">
              {{ loading ? '创建中...' : '创建房间' }}
            </button>
          </div>

          <div v-else class="entry-form">
            <p class="entry-desc">输入对方分享的4位房间号</p>
            <input
              v-model="joinRoomId"
              type="text"
              class="room-input"
              placeholder="请输入4位房间号"
              maxlength="4"
              @keyup.enter="handleJoinRoom"
            />
            <button class="primary-btn" @click="handleJoinRoom" :disabled="loading || joinRoomId.length !== 4">
              {{ loading ? '加入中...' : '加入房间' }}
            </button>
          </div>

          <div v-if="error" class="error-msg">{{ error }}</div>
        </div>
      </div>

      <div v-else class="chat-room">
        <div class="room-header">
          <div class="room-info">
            <span class="room-label">房间号</span>
            <span class="room-id">{{ currentRoomId }}</span>
            <button class="copy-btn" @click="copyRoomId" :title="'复制房间号'">
              {{ copied ? '已复制' : '复制' }}
            </button>
          </div>
          <div class="connection-status">
            <span class="status-dot" :class="{ connected: webrtcConnected }"></span>
            <span class="status-text">
              {{ webrtcConnected ? 'P2P已连接' : (peerJoined ? '连接中...' : '等待对方加入') }}
            </span>
          </div>
          <button class="leave-btn" @click="handleLeave">离开</button>
        </div>

        <div class="messages-container" ref="messagesContainer">
          <div v-if="messages.length === 0" class="empty-state">
            <div class="empty-icon">🔒</div>
            <p>暂无消息</p>
            <p class="empty-hint">消息将端到端加密传输，阅后5秒自动销毁</p>
          </div>

          <div
            v-for="msg in messages"
            :key="msg.id"
            class="message-item"
            :class="{
              'message-sent': msg.sent,
              'message-received': !msg.sent,
              'message-destroying': msg.destroying,
              'message-destroyed': msg.destroyed
            }"
          >
            <div v-if="msg.destroyed" class="destroyed-content">
              <span class="destroyed-icon">💨</span>
              <span>消息已销毁</span>
            </div>

            <div v-else-if="!msg.sent && !msg.viewed" class="blurred-content">
              <div class="blurred-text">******</div>
              <button class="view-btn" @click="viewMessage(msg)">
                点击查看
              </button>
              <p class="burn-hint">查看后5秒自动销毁</p>
            </div>

            <div v-else class="message-content">
              <div class="message-text">{{ msg.text }}</div>
              <div class="message-meta">
                <span>{{ formatTime(msg.timestamp) }}</span>
                <span v-if="msg.sent && !msg.destroyed && !msg.viewed">已送达 · 待查看</span>
                <span v-else-if="msg.sent && msg.viewed && !msg.destroyed">已查看 · {{ getCountdown(msg) }}s 后销毁</span>
                <span v-else-if="!msg.destroyed" class="burn-countdown">
                  {{ getCountdown(msg) }}s 后销毁
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="input-area">
          <textarea
            v-model="inputText"
            class="message-input"
            placeholder="输入要发送的消息..."
            rows="3"
            @keyup.ctrl.enter="handleSend"
            :disabled="!webrtcConnected"
          ></textarea>
          <button
            class="send-btn"
            @click="handleSend"
            :disabled="!webrtcConnected || !inputText.trim()"
          >
            <span>发送</span>
            <span class="send-hint">(Ctrl+Enter)</span>
          </button>
        </div>

        <div v-if="!webrtcConnected" class="connection-warning">
          ⚠️ 等待对方连接后才能发送消息
        </div>
      </div>
    </main>

    <footer class="app-footer">
      <p>消息仅在双方内存中传输，阅后即焚，不留痕迹</p>
    </footer>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useSocket, createRoom, joinRoom, notifyMessageDestroyed } from './composables/useSocket';
import { useWebRTC } from './composables/useWebRTC';

const BURN_DELAY = 5000;

const socket = useSocket();
const { isConnected: webrtcConnected, setPeerId, sendMessage, onMessage, onConnectionChange, cleanup: cleanupWebRTC } = useWebRTC();

const entryMode = ref('create');
const loading = ref(false);
const error = ref('');
const inRoom = ref(false);
const currentRoomId = ref('');
const joinRoomId = ref('');
const peerJoined = ref(false);
const copied = ref(false);

const messages = ref([]);
const inputText = ref('');
const messagesContainer = ref(null);

let removeMessageListener = null;
let removeConnectionListener = null;
const destroyTimers = new Map();
let globalCheckTimer = null;

function generateMessageId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getCountdown(msg) {
  if (!msg.viewed || msg.destroyed) return 0;
  const remaining = Math.max(0, Math.ceil((msg.destroyAt - Date.now()) / 1000));
  return remaining;
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
}

function startGlobalCheck() {
  if (globalCheckTimer) return;
  globalCheckTimer = setInterval(() => {
    const now = Date.now();
    for (const msg of messages.value) {
      if (msg.viewed && !msg.destroyed && msg.destroyAt && now >= msg.destroyAt) {
        destroyMessage(msg, !msg.sent);
      }
    }
  }, 1000);
}

function stopGlobalCheck() {
  if (globalCheckTimer) {
    clearInterval(globalCheckTimer);
    globalCheckTimer = null;
  }
}

function setupVisibilityListener() {
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function removeVisibilityListener() {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
}

function handleVisibilityChange() {
  if (!document.hidden) {
    const now = Date.now();
    for (const msg of messages.value) {
      if (msg.viewed && !msg.destroyed && msg.destroyAt) {
        if (now >= msg.destroyAt) {
          destroyMessage(msg, !msg.sent);
        } else {
          scheduleDestroy(msg);
        }
      }
    }
  }
}

function scheduleDestroy(msg) {
  if (destroyTimers.has(msg.id)) {
    clearTimeout(destroyTimers.get(msg.id));
  }

  const delay = Math.max(0, msg.destroyAt - Date.now());

  const timer = setTimeout(() => {
    destroyTimers.delete(msg.id);
    destroyMessage(msg, !msg.sent);
  }, delay);

  destroyTimers.set(msg.id, timer);
}

function markMessageViewed(msg, viewedAt) {
  if (msg.viewed) return;

  msg.viewed = true;
  msg.viewedAt = viewedAt || Date.now();
  msg.destroyAt = msg.viewedAt + BURN_DELAY;

  scheduleDestroy(msg);
}

function destroyMessage(msg, notifyPeer) {
  if (msg.destroyed) return;

  if (destroyTimers.has(msg.id)) {
    clearTimeout(destroyTimers.get(msg.id));
    destroyTimers.delete(msg.id);
  }

  msg.destroying = true;

  setTimeout(() => {
    msg.destroyed = true;
    msg.text = '';
    msg.destroyedAt = Date.now();
  }, 500);

  if (notifyPeer) {
    if (msg.sent) {
      sendMessage({
        type: 'destroyed',
        messageId: msg.id
      });
    } else {
      notifyMessageDestroyed(msg.id);
    }
  }
}

function syncMessageStatus(messageId, status, extra = {}) {
  let msg = messages.value.find((m) => m.id === messageId);

  if (!msg && extra.text && extra.timestamp) {
    msg = {
      id: messageId,
      text: extra.text,
      sent: false,
      timestamp: extra.timestamp,
      viewed: false,
      destroying: false,
      destroyed: false
    };
    messages.value.push(msg);
    scrollToBottom();
  }

  if (!msg) return;

  if (status === 'viewed' && !msg.viewed) {
    markMessageViewed(msg, extra.viewedAt);
  } else if (status === 'destroyed' && !msg.destroyed) {
    destroyMessage(msg, false);
  }
}

function handleIncomingMessage(data) {
  if (data.type === 'text') {
    const existing = messages.value.find((m) => m.id === data.id);
    if (existing) {
      if (!existing.viewed && data.status === 'viewed') {
        markMessageViewed(existing, data.viewedAt);
      }
      if (data.status === 'destroyed') {
        destroyMessage(existing, false);
      }
      return;
    }

    const msg = {
      id: data.id,
      text: data.text,
      sent: false,
      timestamp: data.timestamp,
      viewed: false,
      destroying: false,
      destroyed: false
    };

    if (data.status === 'viewed') {
      markMessageViewed(msg, data.viewedAt);
    }
    if (data.status === 'destroyed') {
      msg.destroyed = true;
      msg.text = '';
    }

    messages.value.push(msg);
    scrollToBottom();

  } else if (data.type === 'viewed') {
    const msg = messages.value.find((m) => m.id === data.messageId);
    if (msg) {
      markMessageViewed(msg, data.viewedAt);
    }

  } else if (data.type === 'destroyed') {
    const msg = messages.value.find((m) => m.id === data.messageId);
    if (msg) {
      destroyMessage(msg, false);
    }

  } else if (data.type === 'sync-request') {
    syncMessagesToPeer();

  } else if (data.type === 'sync-batch') {
    for (const item of data.messages) {
      syncMessageStatus(item.id, item.status, {
        text: item.text,
        timestamp: item.timestamp,
        viewedAt: item.viewedAt
      });
    }
  }
}

function syncMessagesToPeer() {
  const syncData = messages.value
    .filter((m) => m.sent && !m.destroyed)
    .map((m) => ({
      id: m.id,
      text: m.text,
      timestamp: m.timestamp,
      status: m.viewed ? 'viewed' : 'pending',
      viewedAt: m.viewedAt || null
    }));

  if (syncData.length > 0) {
    sendMessage({
      type: 'sync-batch',
      messages: syncData
    });
  }
}

function viewMessage(msg) {
  if (msg.viewed) return;

  const viewedAt = Date.now();
  markMessageViewed(msg, viewedAt);

  sendMessage({
    type: 'viewed',
    messageId: msg.id,
    viewedAt: viewedAt
  });
}

function handleSend() {
  if (!inputText.value.trim() || !webrtcConnected.value) return;

  const messageId = generateMessageId();
  const now = Date.now();
  const message = {
    id: messageId,
    text: inputText.value.trim(),
    sent: true,
    timestamp: now,
    viewed: false,
    destroying: false,
    destroyed: false
  };

  const success = sendMessage({
    type: 'text',
    id: messageId,
    text: message.text,
    timestamp: message.timestamp,
    status: 'pending'
  });

  if (success) {
    messages.value.push(message);
    inputText.value = '';
    scrollToBottom();
  }
}

function copyRoomId() {
  navigator.clipboard.writeText(currentRoomId.value).then(() => {
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  });
}

function handleWebRtcConnected() {
  const sentMessages = messages.value.filter((m) => m.sent);
  if (sentMessages.length > 0) {
    setTimeout(() => {
      syncMessagesToPeer();
    }, 500);
  } else {
    sendMessage({
      type: 'sync-request'
    });
  }
}

async function handleCreateRoom() {
  loading.value = true;
  error.value = '';
  try {
    const response = await createRoom();
    if (response.success) {
      currentRoomId.value = response.roomId;
      inRoom.value = true;
      setupRoomListeners();
    } else {
      error.value = response.error || '创建失败';
    }
  } catch (e) {
    error.value = '创建房间失败，请重试';
  } finally {
    loading.value = false;
  }
}

async function handleJoinRoom() {
  if (joinRoomId.value.length !== 4) return;
  loading.value = true;
  error.value = '';
  try {
    const response = await joinRoom(joinRoomId.value);
    if (response.success) {
      currentRoomId.value = response.roomId;
      inRoom.value = true;
      setupRoomListeners();
    } else {
      error.value = response.error || '加入失败';
    }
  } catch (e) {
    error.value = '加入房间失败，请重试';
  } finally {
    loading.value = false;
  }
}

function setupRoomListeners() {
  startGlobalCheck();
  setupVisibilityListener();

  socket.on('peer-joined', ({ peerId }) => {
    peerJoined.value = true;
    const isInitiator = !socket.id || socket.id < peerId;
    setPeerId(peerId, isInitiator);
  });

  socket.on('peer-left', () => {
    peerJoined.value = false;
  });

  socket.on('message-destroyed', ({ messageId }) => {
    const msg = messages.value.find((m) => m.id === messageId);
    if (msg) {
      destroyMessage(msg, false);
    }
  });

  removeMessageListener = onMessage(handleIncomingMessage);

  let wasConnected = false;
  removeConnectionListener = onConnectionChange((connected) => {
    if (connected && !wasConnected) {
      wasConnected = true;
      handleWebRtcConnected();
    } else if (!connected) {
      wasConnected = false;
    }
    if (connected) {
      scrollToBottom();
    }
  });
}

function handleLeave() {
  stopGlobalCheck();
  removeVisibilityListener();

  for (const [, timer] of destroyTimers) {
    clearTimeout(timer);
  }
  destroyTimers.clear();

  if (removeMessageListener) removeMessageListener();
  if (removeConnectionListener) removeConnectionListener();

  cleanupWebRTC();
  socket.disconnect();
  socket.connect();

  inRoom.value = false;
  currentRoomId.value = '';
  joinRoomId.value = '';
  peerJoined.value = false;
  messages.value = [];
  inputText.value = '';
  error.value = '';
}

onMounted(() => {
  watch(
    () => webrtcConnected.value,
    (connected) => {
      if (connected) {
        scrollToBottom();
      }
    }
  );
});

onUnmounted(() => {
  stopGlobalCheck();
  removeVisibilityListener();

  for (const [, timer] of destroyTimers) {
    clearTimeout(timer);
  }
  destroyTimers.clear();

  if (removeMessageListener) removeMessageListener();
  if (removeConnectionListener) removeConnectionListener();

  cleanupWebRTC();
});
</script>
