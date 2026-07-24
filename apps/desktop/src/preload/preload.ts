import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type {
  PlayerCommandMessage,
  PlayerStateMessage,
  SubtitleUpdateMessage
} from "@youtube-subtitle-companion/shared";

import {
  IPC_CHANNELS,
  type OverlayApi,
  type OverlayContextMenuRequest
} from "../common/ipc";
import type { AppConfig, OverlayConnectionState, OverlayInitialState } from "../common/types";

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
  onPlayerState: (listener: (playerState: PlayerStateMessage | null) => void) =>
    subscribe<PlayerStateMessage | null>(IPC_CHANNELS.playerStateUpdated, listener),
  onSubtitle: (listener: (subtitle: SubtitleUpdateMessage | null) => void) =>
    subscribe<SubtitleUpdateMessage | null>(IPC_CHANNELS.subtitleUpdated, listener),
  sendPlayerCommand: (command: PlayerCommandMessage) => {
    ipcRenderer.send(IPC_CHANNELS.sendPlayerCommand, command);
  },
  toggleOverlay: () => {
    ipcRenderer.send(IPC_CHANNELS.toggleOverlay);
  },
  toggleInteraction: () => {
    ipcRenderer.send(IPC_CHANNELS.toggleInteraction);
  },
  adjustFont: (delta: number) => {
    ipcRenderer.send(IPC_CHANNELS.adjustFont, delta);
  },
  openContextMenu: (payload: OverlayContextMenuRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.openContextMenu, payload)
};

contextBridge.exposeInMainWorld("overlayApi", api);
