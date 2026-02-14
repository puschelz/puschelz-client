import { parse } from "luaparse";
import type { CalendarEvent, GuildBankItem, GuildBankTab, ParsedPuschelzDb } from "./types";

type LuaNode = {
  type: string;
  [key: string]: unknown;
};

type LuaTableField = LuaNode;

function toValue(node: LuaNode): unknown {
  switch (node.type) {
    case "NumericLiteral":
    case "BooleanLiteral":
      return node.value;
    case "StringLiteral":
      if (typeof node.value === "string") {
        return node.value;
      }
      if (typeof node.raw === "string") {
        return node.raw.replace(/^['"]|['"]$/g, "");
      }
      return "";
    case "NilLiteral":
      return null;
    case "UnaryExpression": {
      const operator = node.operator;
      const argument = node.argument as LuaNode;
      if (operator === "-") {
        const parsed = toValue(argument);
        if (typeof parsed === "number") {
          return -parsed;
        }
      }
      return null;
    }
    case "TableConstructorExpression":
      return toTable(node.fields as LuaTableField[]);
    case "Identifier":
      return node.name;
    default:
      return null;
  }
}

function toTable(fields: LuaTableField[]): unknown {
  const allArray = fields.every((field) => field.type === "TableValue");
  if (allArray) {
    return fields.map((field) => toValue(field.value as LuaNode));
  }

  const out: Record<string, unknown> = {};
  let autoIndex = 1;

  for (const field of fields) {
    if (field.type === "TableKeyString") {
      const rawKey = field.key as LuaNode;
      const keyName =
        (typeof rawKey.name === "string" ? rawKey.name : undefined) ??
        (typeof rawKey.value === "string" ? rawKey.value : "");
      out[keyName] = toValue(field.value as LuaNode);
      continue;
    }

    if (field.type === "TableKey") {
      const key = toValue(field.key as LuaNode);
      if (typeof key === "number" || typeof key === "string") {
        out[String(key)] = toValue(field.value as LuaNode);
      }
      continue;
    }

    if (field.type === "TableValue") {
      out[String(autoIndex)] = toValue(field.value as LuaNode);
      autoIndex += 1;
    }
  }

  return out;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseGuildBankItems(value: unknown): GuildBankItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      slotIndex: asNumber(item.slotIndex),
      itemId: asNumber(item.itemId),
      itemName: asString(item.itemName),
      itemIcon: asString(item.itemIcon),
      quantity: asNumber(item.quantity),
    }));
}

function parseGuildBankTabs(value: unknown): GuildBankTab[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((tab): tab is Record<string, unknown> => !!tab && typeof tab === "object")
    .map((tab) => ({
      tabIndex: asNumber(tab.tabIndex),
      tabName: asString(tab.tabName),
      items: parseGuildBankItems(tab.items),
    }));
}

function parseCalendarEvents(value: unknown): CalendarEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((event): event is Record<string, unknown> => !!event && typeof event === "object")
    .map((event) => ({
      wowEventId: asNumber(event.wowEventId),
      title: asString(event.title),
      eventType: event.eventType === "world" ? "world" : "raid",
      startTime: asNumber(event.startTime),
      endTime: asNumber(event.endTime),
    }));
}

export function parseSavedVariables(luaSource: string): ParsedPuschelzDb {
  const chunk = parse(luaSource) as LuaNode;
  const body = (chunk.body as LuaNode[]) ?? [];

  const assignment = body.find(
    (statement) => statement.type === "AssignmentStatement"
  ) as LuaNode | undefined;

  if (!assignment) {
    throw new Error("No Lua assignment found in SavedVariables file");
  }

  const init = ((assignment.init as LuaNode[]) ?? [])[0];
  if (!init || init.type !== "TableConstructorExpression") {
    throw new Error("SavedVariables payload is not a table");
  }

  const root = toValue(init) as Record<string, unknown>;
  const guildBank = (root.guildBank as Record<string, unknown>) ?? {};
  const calendar = (root.calendar as Record<string, unknown>) ?? {};

  return {
    schemaVersion: asNumber(root.schemaVersion),
    updatedAt: asNumber(root.updatedAt),
    player: (root.player as ParsedPuschelzDb["player"]) ?? undefined,
    guildBank: {
      lastScannedAt: asNumber(guildBank.lastScannedAt),
      tabs: parseGuildBankTabs(guildBank.tabs),
    },
    calendar: {
      lastScannedAt: asNumber(calendar.lastScannedAt),
      events: parseCalendarEvents(calendar.events),
    },
  };
}
