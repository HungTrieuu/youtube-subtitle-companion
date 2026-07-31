import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type {
  DeleteLearningItemRequest,
  DeleteLearningItemResponse,
  LearningItem,
  SaveLearningItemRequest,
  SaveLearningItemResponse
} from "../common/learning";
import { normalizeLearningWord } from "../common/learning";
import { logger } from "./logger";

const learningItemSchema = z.object({
  word: z.string().min(1),
  sentence: z.string().min(1),
  videoId: z.string().nullable(),
  videoTitle: z.string().nullable(),
  timestampMs: z.number().int().min(0),
  savedAt: z.string().min(1),
  status: z.literal("new")
});

const learningDayFileSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(learningItemSchema)
});

type LearningDayFile = z.infer<typeof learningDayFileSchema>;

const pad = (value: number): string => String(value).padStart(2, "0");

export const roundLearningTimestamp = (timestampMs: number): number =>
  Math.round(timestampMs / 1000) * 1000;

export const formatLocalIsoTimestamp = (date: Date): string => {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffset / 60);
  const offsetRemainderMinutes = absoluteOffset % 60;

  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const offsetPart = `${sign}${pad(offsetHours)}:${pad(offsetRemainderMinutes)}`;

  return `${datePart}T${timePart}${offsetPart}`;
};

export const getLearningDateParts = (date: Date): {
  year: string;
  month: string;
  date: string;
} => {
  const year = String(date.getFullYear());
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());

  return {
    year,
    month,
    date: `${year}-${month}-${day}`
  };
};

const getLearningDatePartsFromIsoDate = (
  isoDate: string
): {
  year: string;
  month: string;
  date: string;
} => ({
  year: isoDate.slice(0, 4),
  month: isoDate.slice(5, 7),
  date: isoDate.slice(0, 10)
});

export const isDuplicateLearningItem = (
  existing: LearningItem,
  candidate: LearningItem
): boolean =>
  normalizeLearningWord(existing.word) === candidate.word &&
  existing.sentence.trim() === candidate.sentence &&
  (existing.videoId ?? null) === candidate.videoId &&
  roundLearningTimestamp(existing.timestampMs) === roundLearningTimestamp(candidate.timestampMs);

export const isSameLearningItem = (
  existing: LearningItem,
  candidate: DeleteLearningItemRequest
): boolean =>
  normalizeLearningWord(existing.word) === normalizeLearningWord(candidate.word) &&
  existing.sentence.trim() === candidate.sentence.trim() &&
  (existing.videoId ?? null) === (candidate.videoId?.trim() || null) &&
  (existing.videoTitle ?? null) === (candidate.videoTitle?.trim() || null) &&
  existing.timestampMs === Math.round(candidate.timestampMs) &&
  existing.savedAt === candidate.savedAt &&
  existing.status === candidate.status;

const readLearningDayFile = async (
  filePath: string,
  date: string
): Promise<LearningDayFile> => {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    const result = learningDayFileSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error("Existing learning data file has an invalid JSON shape.");
    }

    return result.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        date,
        items: []
      };
    }

    throw error;
  }
};

const collectLearningFilePaths = async (directory: string): Promise<string[]> => {
  try {
    const entries = await fs.readdir(directory, {
      withFileTypes: true
    });
    const nestedPaths = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          return collectLearningFilePaths(fullPath);
        }

        return entry.isFile() && entry.name.endsWith(".json") ? [fullPath] : [];
      })
    );

    return nestedPaths.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

const getComparableSavedAtTimestamp = (item: LearningItem): number => {
  const timestamp = new Date(item.savedAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const sortLearningItemsNewestFirst = (left: LearningItem, right: LearningItem): number =>
  getComparableSavedAtTimestamp(right) - getComparableSavedAtTimestamp(left);

export class LearningStore {
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly baseDir: string) {}

  public save(request: SaveLearningItemRequest): Promise<SaveLearningItemResponse> {
    const task = this.writeQueue.then(async () => this.saveInternal(request));
    this.writeQueue = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }

  public delete(request: DeleteLearningItemRequest): Promise<DeleteLearningItemResponse> {
    const task = this.writeQueue.then(async () => this.deleteInternal(request));
    this.writeQueue = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }

  public async listItems(): Promise<LearningItem[]> {
    const filePaths = await collectLearningFilePaths(this.baseDir);
    const dayFiles = await Promise.all(
      filePaths.map(async (filePath) => {
        try {
          return await readLearningDayFile(filePath, path.basename(filePath, ".json"));
        } catch (error) {
          logger.warn("learning", "Skipping unreadable learning data file", {
            filePath,
            error: error instanceof Error ? error.message : String(error)
          });
          return null;
        }
      })
    );

    return dayFiles
      .flatMap((dayFile) => dayFile?.items ?? [])
      .sort(sortLearningItemsNewestFirst);
  }

  private async saveInternal(
    request: SaveLearningItemRequest
  ): Promise<SaveLearningItemResponse> {
    try {
      const item = this.buildLearningItem(request);
      const dateParts = getLearningDateParts(new Date(item.savedAt));
      const directory = path.join(this.baseDir, dateParts.year, dateParts.month);
      const filePath = path.join(directory, `${dateParts.date}.json`);

      await fs.mkdir(directory, {
        recursive: true
      });

      const currentFile = await readLearningDayFile(filePath, dateParts.date);

      if (currentFile.items.some((existing) => isDuplicateLearningItem(existing, item))) {
        return {
          success: true,
          duplicate: true
        };
      }

      const nextFile: LearningDayFile = {
        date: currentFile.date,
        items: [...currentFile.items, item]
      };

      const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

      await fs.writeFile(tempFilePath, `${JSON.stringify(nextFile, null, 2)}\n`, "utf8");
      await fs.rename(tempFilePath, filePath);

      return {
        success: true,
        duplicate: false
      };
    } catch (error) {
      logger.error("learning", "Failed to save learning item", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save learning item."
      };
    }
  }

  private async deleteInternal(
    request: DeleteLearningItemRequest
  ): Promise<DeleteLearningItemResponse> {
    try {
      const item = this.buildDeleteRequest(request);
      const dateParts = getLearningDatePartsFromIsoDate(item.savedAt);
      const directory = path.join(this.baseDir, dateParts.year, dateParts.month);
      const filePath = path.join(directory, `${dateParts.date}.json`);
      const currentFile = await readLearningDayFile(filePath, dateParts.date);
      const nextItems = currentFile.items.filter((existing) => !isSameLearningItem(existing, item));

      if (nextItems.length === currentFile.items.length) {
        return {
          success: true,
          deleted: false
        };
      }

      const nextFile: LearningDayFile = {
        date: currentFile.date,
        items: nextItems
      };
      const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

      await fs.mkdir(directory, {
        recursive: true
      });
      await fs.writeFile(tempFilePath, `${JSON.stringify(nextFile, null, 2)}\n`, "utf8");
      await fs.rename(tempFilePath, filePath);

      return {
        success: true,
        deleted: true
      };
    } catch (error) {
      logger.error("learning", "Failed to delete learning item", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete learning item."
      };
    }
  }

  private buildLearningItem(request: SaveLearningItemRequest): LearningItem {
    const word = normalizeLearningWord(request.word);
    const sentence = request.sentence.trim();

    if (!word) {
      throw new Error("The selected word is invalid.");
    }

    if (!sentence) {
      throw new Error("The current subtitle line is empty.");
    }

    if (!Number.isFinite(request.timestampMs) || request.timestampMs < 0) {
      throw new Error("The subtitle timestamp is invalid.");
    }

    const savedAtDate = new Date();
    return {
      word,
      sentence,
      videoId: request.videoId?.trim() || null,
      videoTitle: request.videoTitle?.trim() || null,
      timestampMs: roundLearningTimestamp(Math.round(request.timestampMs)),
      savedAt: formatLocalIsoTimestamp(savedAtDate),
      status: "new"
    };
  }

  private buildDeleteRequest(request: DeleteLearningItemRequest): DeleteLearningItemRequest {
    const word = normalizeLearningWord(request.word);
    const sentence = request.sentence.trim();
    const savedAt = request.savedAt.trim();
    const savedAtDate = new Date(savedAt);

    if (!word) {
      throw new Error("The selected word is invalid.");
    }

    if (!sentence) {
      throw new Error("The current subtitle line is empty.");
    }

    if (!savedAt || Number.isNaN(savedAtDate.getTime())) {
      throw new Error("The saved timestamp is invalid.");
    }

    if (!Number.isFinite(request.timestampMs) || request.timestampMs < 0) {
      throw new Error("The subtitle timestamp is invalid.");
    }

    if (request.status !== "new") {
      throw new Error("The learning item status is invalid.");
    }

    return {
      word,
      sentence,
      videoId: request.videoId?.trim() || null,
      videoTitle: request.videoTitle?.trim() || null,
      timestampMs: Math.round(request.timestampMs),
      savedAt,
      status: "new"
    };
  }
}
