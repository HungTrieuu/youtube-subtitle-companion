import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LearningItem } from "../common/learning";
import {
  LearningStore,
  formatLocalIsoTimestamp,
  getLearningDateParts,
  isDuplicateLearningItem,
  isSameLearningItem,
  roundLearningTimestamp
} from "./learning-store";

const baseItem: LearningItem = {
  word: "development",
  sentence: "Software development requires continuous learning.",
  videoId: "abc123",
  videoTitle: "Developer Habits",
  timestampMs: 125400,
  savedAt: "2026-07-30T18:20:00+07:00",
  status: "new"
};

describe("learning store helpers", () => {
  it("rounds timestamps to the nearest second", () => {
    expect(roundLearningTimestamp(125400)).toBe(125000);
    expect(roundLearningTimestamp(125600)).toBe(126000);
  });

  it("treats near-identical items as duplicates", () => {
    expect(
      isDuplicateLearningItem(baseItem, {
        ...baseItem,
        timestampMs: 125900
      })
    ).toBe(true);
  });

  it("keeps ISO timestamps with a timezone offset", () => {
    expect(formatLocalIsoTimestamp(new Date("2026-07-30T18:20:00+07:00"))).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
    );
  });

  it("matches the exact saved item when deleting", () => {
    expect(
      isSameLearningItem(baseItem, {
        ...baseItem
      })
    ).toBe(true);

    expect(
      isSameLearningItem(baseItem, {
        ...baseItem,
        savedAt: "2026-07-30T18:21:00+07:00"
      })
    ).toBe(false);
  });
});

describe("LearningStore", () => {
  let baseDir: string;
  let store: LearningStore;

  const createRequest = (overrides: Partial<Parameters<LearningStore["save"]>[0]> = {}) => ({
    word: "development",
    sentence: "Software development requires continuous learning.",
    videoId: "abc123",
    videoTitle: "Developer Habits",
    timestampMs: 125400,
    ...overrides
  });

  const getExpectedFilePath = (): string => {
    const dateParts = getLearningDateParts(new Date());
    return path.join(baseDir, dateParts.year, dateParts.month, `${dateParts.date}.json`);
  };

  const readSavedItems = async (): Promise<LearningItem[]> => {
    const content = await fs.readFile(getExpectedFilePath(), "utf8");
    return (JSON.parse(content) as { items: LearningItem[] }).items;
  };

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "ysc-learning-"));
    store = new LearningStore(baseDir);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T18:20:00+07:00"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(baseDir, {
      recursive: true,
      force: true
    });
  });

  it("creates the daily directory and file when saving the first item", async () => {
    const response = await store.save(createRequest());

    expect(response).toEqual({
      success: true,
      duplicate: false
    });

    const filePath = getExpectedFilePath();
    const content = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      date: string;
      items: LearningItem[];
    };

    expect(content.items).toHaveLength(1);
    expect(content.items[0]).toMatchObject({
      word: "development",
      sentence: "Software development requires continuous learning.",
      videoId: "abc123",
      videoTitle: "Developer Habits",
      status: "new"
    });
  });

  it("appends new items to the current day file", async () => {
    await store.save(createRequest());
    await store.save(
      createRequest({
        word: "learning",
        timestampMs: 126700
      })
    );

    const items = await readSavedItems();
    expect(items.map((item) => item.word)).toEqual(["development", "learning"]);
  });

  it("does not save duplicates for the same word, sentence, video, and nearby timestamp", async () => {
    await store.save(createRequest());

    const response = await store.save(
      createRequest({
        timestampMs: 125900
      })
    );

    expect(response).toEqual({
      success: true,
      duplicate: true
    });
    expect(await readSavedItems()).toHaveLength(1);
  });

  it("preserves all items when save requests happen back-to-back", async () => {
    const first = createRequest();
    const second = createRequest({
      word: "learning",
      timestampMs: 130000
    });

    const responses = await Promise.all([store.save(first), store.save(second)]);

    expect(responses).toEqual([
      {
        success: true,
        duplicate: false
      },
      {
        success: true,
        duplicate: false
      }
    ]);
    expect(await readSavedItems()).toHaveLength(2);
  });

  it("returns an error response instead of crashing on invalid existing JSON", async () => {
    const filePath = getExpectedFilePath();

    await fs.mkdir(path.dirname(filePath), {
      recursive: true
    });
    await fs.writeFile(filePath, "{not valid json", "utf8");

    const response = await store.save(createRequest());

    expect(response.success).toBe(false);
  });

  it("lists saved items across days with newest items first", async () => {
    vi.setSystemTime(new Date("2026-07-29T09:15:00+07:00"));
    await store.save(
      createRequest({
        word: "earlier",
        timestampMs: 91000
      })
    );

    vi.setSystemTime(new Date("2026-07-30T18:20:00+07:00"));
    await store.save(createRequest());
    await store.save(
      createRequest({
        word: "latest",
        timestampMs: 130000
      })
    );

    await expect(store.listItems()).resolves.toMatchObject([
      {
        word: "latest"
      },
      {
        word: "development"
      },
      {
        word: "earlier"
      }
    ]);
  });

  it("returns an empty list when no learning data exists yet", async () => {
    await expect(store.listItems()).resolves.toEqual([]);
  });

  it("deletes a saved item from the day file", async () => {
    await store.save(createRequest());
    await store.save(
      createRequest({
        word: "learning",
        timestampMs: 126700
      })
    );

    const [firstItem] = await readSavedItems();
    const response = await store.delete(firstItem!);

    expect(response).toEqual({
      success: true,
      deleted: true
    });
    await expect(readSavedItems()).resolves.toMatchObject([
      {
        word: "learning"
      }
    ]);
  });

  it("reports deleted false when the item no longer exists", async () => {
    const response = await store.delete(baseItem);

    expect(response).toEqual({
      success: true,
      deleted: false
    });
  });
});
