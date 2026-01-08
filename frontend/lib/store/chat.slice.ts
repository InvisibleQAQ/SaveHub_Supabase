/**
 * Chat Zustand Slice
 *
 * 管理聊天会话和消息状态
 */

import type { StateCreator } from "zustand"
import { chatApi, type ChatSession, type Message } from "../api/chat"
import type { RetrievedSource } from "../api/rag-chat"

export interface ChatSlice {
  // State
  chatSessions: ChatSession[]
  currentSessionId: string | null
  currentMessages: Message[]
  currentSources: RetrievedSource[]
  isChatLoading: boolean

  // Actions
  loadChatSessions: () => Promise<void>
  loadSessionMessages: (sessionId: string) => Promise<void>
  createChatSession: (sessionId?: string) => Promise<ChatSession>
  deleteChatSession: (sessionId: string) => Promise<void>
  updateChatSessionTitle: (sessionId: string, title: string) => Promise<void>
  setCurrentSessionId: (sessionId: string | null) => void
  addLocalMessage: (message: Omit<Message, "id" | "created_at">) => void
  updateLastMessageContent: (content: string) => void
  setCurrentSources: (sources: RetrievedSource[]) => void
  clearCurrentChat: () => void
  refreshSessionInList: (sessionId: string) => void
}

export const createChatSlice: StateCreator<ChatSlice, [], [], ChatSlice> = (set, get) => ({
  // Initial state
  chatSessions: [],
  currentSessionId: null,
  currentMessages: [],
  currentSources: [],
  isChatLoading: false,

  // Actions
  loadChatSessions: async () => {
    try {
      const sessions = await chatApi.listSessions()
      set({ chatSessions: sessions })
    } catch (error) {
      console.error("Failed to load chat sessions:", error)
    }
  },

  loadSessionMessages: async (sessionId: string) => {
    set({ isChatLoading: true })
    try {
      const messages = await chatApi.getSessionMessages(sessionId)
      set({
        currentMessages: messages,
        currentSessionId: sessionId,
        currentSources: [],
      })
    } catch (error) {
      console.error("Failed to load messages:", error)
    } finally {
      set({ isChatLoading: false })
    }
  },

  createChatSession: async (sessionId?: string) => {
    const id = sessionId || crypto.randomUUID()
    try {
      const session = await chatApi.createSession(id)
      set((state) => ({
        chatSessions: [session, ...state.chatSessions],
        currentSessionId: session.id,
        currentMessages: [],
        currentSources: [],
      }))
      return session
    } catch (error) {
      console.error("Failed to create session:", error)
      throw error
    }
  },

  deleteChatSession: async (sessionId: string) => {
    try {
      await chatApi.deleteSession(sessionId)
      const state = get()
      set({
        chatSessions: state.chatSessions.filter((s) => s.id !== sessionId),
        currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
        currentMessages: state.currentSessionId === sessionId ? [] : state.currentMessages,
        currentSources: state.currentSessionId === sessionId ? [] : state.currentSources,
      })
    } catch (error) {
      console.error("Failed to delete session:", error)
    }
  },

  updateChatSessionTitle: async (sessionId: string, title: string) => {
    try {
      await chatApi.updateSession(sessionId, { title })
      set((state) => ({
        chatSessions: state.chatSessions.map((s) =>
          s.id === sessionId ? { ...s, title } : s
        ),
      }))
    } catch (error) {
      console.error("Failed to update title:", error)
    }
  },

  setCurrentSessionId: (sessionId: string | null) => {
    if (sessionId) {
      get().loadSessionMessages(sessionId)
    } else {
      set({ currentSessionId: null, currentMessages: [], currentSources: [] })
    }
  },

  addLocalMessage: (message) => {
    const newMessage: Message = {
      ...message,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    }
    set((state) => ({
      currentMessages: [...state.currentMessages, newMessage],
    }))
  },

  updateLastMessageContent: (content: string) => {
    set((state) => {
      const messages = [...state.currentMessages]
      if (messages.length > 0) {
        messages[messages.length - 1] = {
          ...messages[messages.length - 1],
          content,
        }
      }
      return { currentMessages: messages }
    })
  },

  setCurrentSources: (sources: RetrievedSource[]) => {
    set({ currentSources: sources })
  },

  clearCurrentChat: () => {
    set({
      currentSessionId: null,
      currentMessages: [],
      currentSources: [],
    })
  },

  refreshSessionInList: (sessionId: string) => {
    // Move session to top and update timestamp
    set((state) => {
      const session = state.chatSessions.find((s) => s.id === sessionId)
      if (!session) return state
      const updated = {
        ...session,
        updated_at: new Date().toISOString(),
      }
      return {
        chatSessions: [updated, ...state.chatSessions.filter((s) => s.id !== sessionId)],
      }
    })
  },
})
