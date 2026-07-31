import { BrowserWindow, ipcMain } from "electron";

import { parseElectronMessage } from "@youtube-subtitle-companion/shared";

import {
  IPC_CHANNELS,
  overlayContextMenuRequestSchema,
  overlayPopupMetricsSchema
} from "../../common/ipc";
import {
  deleteLearningItemRequestSchema,
  dictionaryLookupRequestSchema,
  saveLearningItemRequestSchema
} from "../../common/learning";
import type { AppContext } from "../app-context";
import {
  clampFont,
  notifyLearningItemsUpdated,
  setOverlayActive,
  setOverlayVisible,
  updateConfig
} from "../actions/app-actions";
import { logger } from "../logger";
import { showOverlayContextMenu } from "../menus/overlay-context-menu";

export const registerIpcHandlers = (context: AppContext): void => {
  ipcMain.handle(IPC_CHANNELS.getInitialState, () => {
    const state = context.runtimeStore.getState();
    return {
      subtitle: state.subtitle,
      playerState: state.player,
      config: context.overlayWindow.getRenderedConfig(),
      connection: state.connection,
      uiState: state.overlay
    };
  });

  ipcMain.on(IPC_CHANNELS.sendPlayerCommand, (_event, payload: unknown) => {
    const command = parseElectronMessage(payload);

    if (command === null) {
      logger.warn("ipc", "Rejected invalid renderer command", payload);
      return;
    }

    void context.websocketServer.sendCommand(command);
  });

  ipcMain.on(IPC_CHANNELS.toggleOverlay, () => {
    setOverlayVisible(context, !context.runtimeStore.getState().config.overlayVisible);
  });

  ipcMain.on(IPC_CHANNELS.toggleOverlayActive, () => {
    setOverlayActive(context, context.runtimeStore.getState().overlay.mode !== "active");
  });

  ipcMain.on(IPC_CHANNELS.adjustFont, (_event, delta: unknown) => {
    if (typeof delta !== "number" || !Number.isFinite(delta)) {
      return;
    }

    updateConfig(context, {
      fontSize: clampFont(context.runtimeStore.getState().config.fontSize + delta)
    });
  });

  ipcMain.handle(IPC_CHANNELS.openContextMenu, (event, payload: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const parsedRequest = overlayContextMenuRequestSchema.safeParse(payload);

    if (!window || !parsedRequest.success) {
      return;
    }

    showOverlayContextMenu(context, window, parsedRequest.data);
  });

  ipcMain.on(IPC_CHANNELS.setPopupMetrics, (_event, payload: unknown) => {
    const parsedMetrics = overlayPopupMetricsSchema.safeParse(payload);

    if (!parsedMetrics.success) {
      return;
    }

    context.overlayWindow.setPopupReservedSpace(
      parsedMetrics.data.visible ? parsedMetrics.data.reservedTop : 0,
      parsedMetrics.data.visible ? parsedMetrics.data.reservedBottom : 0
    );
  });

  ipcMain.handle(IPC_CHANNELS.lookupDictionary, (_event, payload: unknown) => {
    const parsedWord = dictionaryLookupRequestSchema.safeParse(payload);

    if (!parsedWord.success) {
      return {
        success: false,
        code: "invalid_word" as const,
        error: "The selected token is invalid."
      };
    }

    return context.dictionaryService.lookup(parsedWord.data);
  });

  ipcMain.handle(IPC_CHANNELS.saveLearningItem, (_event, payload: unknown) => {
    const parsedRequest = saveLearningItemRequestSchema.safeParse(payload);

    if (!parsedRequest.success) {
      return {
        success: false,
        error: "The learning item payload is invalid."
      };
    }

    return context.learningStore.save(parsedRequest.data).then((response) => {
      if (response.success && !response.duplicate) {
        notifyLearningItemsUpdated(context);
      }

      return response;
    });
  });

  ipcMain.handle(IPC_CHANNELS.getLearningItems, async () => {
    try {
      return {
        success: true,
        items: await context.learningStore.listItems()
      };
    } catch (error) {
      logger.error("learning", "Failed to list learning items", error);
      return {
        success: false,
        error: "Không thể tải danh sách từ đã lưu."
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.deleteLearningItem, (_event, payload: unknown) => {
    const parsedRequest = deleteLearningItemRequestSchema.safeParse(payload);

    if (!parsedRequest.success) {
      return {
        success: false,
        error: "The learning item payload is invalid."
      };
    }

    return context.learningStore.delete(parsedRequest.data).then((response) => {
      if (response.success && response.deleted) {
        notifyLearningItemsUpdated(context);
      }

      return response;
    });
  });
};
