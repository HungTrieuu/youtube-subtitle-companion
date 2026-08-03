import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type {
  PlayerCommandMessage,
  PlayerStateMessage,
  SubtitleUpdateMessage
} from "@youtube-subtitle-companion/shared";

import {
  IPC_CHANNELS,
  type OverlayApi,
  type OverlayContextMenuRequest,
  type OverlayPopupMetrics
} from "../common/ipc";
import type {
  DeleteLearningItemRequest,
  DeleteLearningItemResponse,
  DictionaryLookupRequest,
  DictionaryLookupResponse,
  LearningItemsResponse,
  SaveLearningItemRequest,
  SaveLearningItemResponse
} from "../common/learning";
import type { SpeakSubtitleRequest, SpeakSubtitleResponse } from "../common/tts";
import type {
  AppConfig,
  OverlayConnectionState,
  OverlayInitialState,
  OverlayUiState
} from "../common/types";

const subscribe = <T>(channel: string, listener: (payload: T) => void) => {
  const wrapped = (_event: IpcRendererEvent, payload: T) => {
    listener(payload);
  };

  ipcRenderer.on(channel, wrapped);

  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
};

const api: OverlayApi = {
  getInitialState: () => ipcRenderer.invoke(IPC_CHANNELS.getInitialState) as Promise<OverlayInitialState>,
  onConfig: (listener: (config: AppConfig) => void) =>
    subscribe<AppConfig>(IPC_CHANNELS.configUpdated, listener),
  onConnection: (listener: (connection: OverlayConnectionState) => void) =>
    subscribe<OverlayConnectionState>(IPC_CHANNELS.connectionUpdated, listener),
  onUiState: (listener: (uiState: OverlayUiState) => void) =>
    subscribe<OverlayUiState>(IPC_CHANNELS.uiStateUpdated, listener),
  onPlayerState: (listener: (playerState: PlayerStateMessage | null) => void) =>
    subscribe<PlayerStateMessage | null>(IPC_CHANNELS.playerStateUpdated, listener),
  onSubtitle: (listener: (subtitle: SubtitleUpdateMessage | null) => void) =>
    subscribe<SubtitleUpdateMessage | null>(IPC_CHANNELS.subtitleUpdated, listener),
  onTemporaryDim: (listener: (active: boolean) => void) =>
    subscribe<boolean>(IPC_CHANNELS.temporaryDimUpdated, listener),
  onLearningItemsUpdated: (listener: () => void) =>
    subscribe<void>(IPC_CHANNELS.learningItemsUpdated, () => {
      listener();
    }),
  sendPlayerCommand: (command: PlayerCommandMessage) => {
    ipcRenderer.send(IPC_CHANNELS.sendPlayerCommand, command);
  },
  toggleOverlay: () => {
    ipcRenderer.send(IPC_CHANNELS.toggleOverlay);
  },
  toggleOverlayActive: () => {
    ipcRenderer.send(IPC_CHANNELS.toggleOverlayActive);
  },
  adjustFont: (delta: number) => {
    ipcRenderer.send(IPC_CHANNELS.adjustFont, delta);
  },
  openContextMenu: (payload: OverlayContextMenuRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.openContextMenu, payload),
  setPopupMetrics: (payload: OverlayPopupMetrics) => {
    ipcRenderer.send(IPC_CHANNELS.setPopupMetrics, payload);
  },
  lookupDictionary: (payload: DictionaryLookupRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.lookupDictionary, payload) as Promise<DictionaryLookupResponse>,
  speakSubtitle: (payload: SpeakSubtitleRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.speakSubtitle, payload) as Promise<SpeakSubtitleResponse>,
  saveLearningItem: (payload: SaveLearningItemRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveLearningItem, payload) as Promise<SaveLearningItemResponse>,
  getLearningItems: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getLearningItems) as Promise<LearningItemsResponse>,
  deleteLearningItem: (payload: DeleteLearningItemRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteLearningItem, payload) as Promise<DeleteLearningItemResponse>
};

contextBridge.exposeInMainWorld("overlayApi", api);
