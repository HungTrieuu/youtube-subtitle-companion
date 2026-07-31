import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";

import { formatHotkeyLabel } from "../../common/hotkey-label";
import type { OverlayContextMenuRequest } from "../../common/ipc";
import type { AppConfig } from "../../common/types";
import type { AppContext } from "../app-context";
import {
  clampFont,
  setOverlayActive,
  setOverlayVisible,
  showSavedWordsWindow,
  updateConfig
} from "../actions/app-actions";

export const showOverlayContextMenu = (
  context: AppContext,
  window: BrowserWindow,
  request: OverlayContextMenuRequest
): void => {
  const state = context.runtimeStore.getState();
  const opacityOptions = [1, 0.85, 0.7];
  const alignmentOptions: AppConfig["alignment"][] = ["left", "center", "right"];

  const template: MenuItemConstructorOptions[] = [
    {
      label: state.config.overlayVisible ? "Hide overlay" : "Show overlay",
      click: () => {
        setOverlayVisible(context, !context.runtimeStore.getState().config.overlayVisible);
      }
    },
    {
      label: `Active overlay (${formatHotkeyLabel(state.config.hotkeys.toggleInteraction)})`,
      type: "checkbox",
      checked: state.overlay.mode === "active",
      click: () => {
        setOverlayActive(context, state.overlay.mode !== "active");
      }
    },
    {
      label:
        state.overlay.mode === "move"
          ? `Move mode is active (${formatHotkeyLabel(state.config.hotkeys.moveOverlay)})`
          : `Move overlay with ${formatHotkeyLabel(state.config.hotkeys.moveOverlay)}`,
      enabled: false
    },
    {
      type: "separator"
    },
    {
      label: "Saved words",
      click: () => {
        void showSavedWordsWindow(context);
      }
    },
    {
      type: "separator"
    },
    {
      label: "Increase font",
      click: () => {
        updateConfig(context, {
          fontSize: clampFont(context.runtimeStore.getState().config.fontSize + 2)
        });
      }
    },
    {
      label: "Decrease font",
      click: () => {
        updateConfig(context, {
          fontSize: clampFont(context.runtimeStore.getState().config.fontSize - 2)
        });
      }
    },
    {
      type: "separator"
    },
    ...alignmentOptions.map((alignment) => ({
      label: `Align ${alignment}`,
      type: "radio" as const,
      checked: state.config.alignment === alignment,
      click: () => {
        updateConfig(context, {
          alignment
        });
      }
    })),
    {
      type: "separator"
    },
    ...opacityOptions.map((opacity) => ({
      label: `Opacity ${Math.round(opacity * 100)}%`,
      type: "radio" as const,
      checked: state.config.opacity === opacity,
      click: () => {
        updateConfig(context, {
          opacity
        });
      }
    }))
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({
    window,
    x: Math.round(request.x),
    y: Math.round(request.y)
  });
};
