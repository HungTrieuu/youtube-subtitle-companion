const HOTKEY_LABELS: Record<string, string> = {
  alt: "Alt",
  command: "Cmd",
  commandorcontrol: "Ctrl",
  cmd: "Cmd",
  cmdorctrl: "Ctrl",
  control: "Ctrl",
  ctrl: "Ctrl",
  meta: "Meta",
  option: "Option",
  shift: "Shift",
  super: "Super"
};

const formatHotkeyToken = (token: string): string => {
  const trimmed = token.trim();

  if (!trimmed) {
    return "";
  }

  const mapped = HOTKEY_LABELS[trimmed.toLowerCase()];

  if (mapped) {
    return mapped;
  }

  if (trimmed.length === 1) {
    return trimmed.toUpperCase();
  }

  return trimmed;
};

export const formatHotkeyLabel = (accelerator: string): string =>
  accelerator
    .split("+")
    .map((part) => formatHotkeyToken(part))
    .filter(Boolean)
    .join("+");
