import { formatHotkeyLabel } from "../../common/hotkey-label";
import type { AppContext } from "../app-context";
import type { DesktopRuntimeState } from "./desktop-runtime-store";

const updateTray = (context: AppContext, state: Readonly<DesktopRuntimeState>): void => {
  context.trayController?.update({
    overlayVisible: state.config.overlayVisible,
    overlayMode: state.overlay.mode,
    activeOverlayHotkeyLabel: formatHotkeyLabel(state.config.hotkeys.toggleInteraction),
    moveOverlayHotkeyLabel: formatHotkeyLabel(state.config.hotkeys.moveOverlay),
    autoStart: state.config.autoStart,
    connected: state.connection.connected
  });
};

export const emitRuntimeState = (context: AppContext): void => {
  context.overlayWindow.sendConfig();
  context.overlayWindow.sendUiState();
  context.overlayWindow.sendConnection(context.runtimeStore.getState().connection);
  context.overlayWindow.sendPlayerState(context.runtimeStore.getState().player);
  context.overlayWindow.sendSubtitle(context.runtimeStore.getState().subtitle);
  context.overlayWindow.sendTemporaryDimState(context.runtimeStore.getState().temporaryDimActive);
  updateTray(context, context.runtimeStore.getState());
};

export const syncRuntimeState = (context: AppContext): (() => void) =>
  context.runtimeStore.subscribe((state, previousState) => {
    if (state.config !== previousState.config) {
      context.overlayWindow.sendConfig();
    }

    if (state.overlay !== previousState.overlay) {
      context.overlayWindow.sendUiState();
    }

    if (state.connection !== previousState.connection) {
      context.overlayWindow.sendConnection(state.connection);
    }

    if (state.player !== previousState.player) {
      context.overlayWindow.sendPlayerState(state.player);
    }

    if (state.subtitle !== previousState.subtitle) {
      context.overlayWindow.sendSubtitle(state.subtitle);
    }

    if (state.temporaryDimActive !== previousState.temporaryDimActive) {
      context.overlayWindow.sendTemporaryDimState(state.temporaryDimActive);
    }

    updateTray(context, state);
  });
