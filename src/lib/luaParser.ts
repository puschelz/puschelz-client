import { parse } from "luaparse";
import type {
  CalendarEvent,
  CalendarEventAttendee,
  GuildOrder,
  GuildBankItem,
  GuildBankTab,
  PendingReloadState,
  ParsedPuschelzDb,
  SimcRequest,
} from "./types";

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

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asLuaArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) {
    return [];
  }

  const numericKeys = keys
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key) && key > 0)
    .sort((a, b) => a - b);

  if (numericKeys.length !== keys.length) {
    return null;
  }

  for (let index = 0; index < numericKeys.length; index += 1) {
    if (numericKeys[index] !== index + 1) {
      return null;
    }
  }

  const table = value as Record<string, unknown>;
  return numericKeys.map((key) => table[String(key)]);
}

function parseGuildBankItems(value: unknown): GuildBankItem[] {
  const rows = asLuaArray(value);
  if (!rows) {
    return [];
  }

  return rows
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
  const rows = asLuaArray(value);
  if (!rows) {
    return [];
  }

  return rows
    .filter((tab): tab is Record<string, unknown> => !!tab && typeof tab === "object")
    .map((tab) => ({
      tabIndex: asNumber(tab.tabIndex),
      tabName: asString(tab.tabName),
      items: parseGuildBankItems(tab.items),
    }));
}

function parseCalendarAttendees(value: unknown): CalendarEventAttendee[] | undefined {
  const rows = asLuaArray(value);
  if (!rows) {
    return undefined;
  }

  const attendees = rows
    .filter((attendee): attendee is Record<string, unknown> => !!attendee && typeof attendee === "object")
    .map((attendee) => {
      const name = asString(attendee.name);
      const status = asString(attendee.status);
      if (!name || (status !== "signedUp" && status !== "tentative")) {
        return null;
      }
      return { name, status };
    })
    .filter((attendee): attendee is CalendarEventAttendee => attendee !== null);

  return attendees.length > 0 ? attendees : undefined;
}

function parseCalendarEvents(value: unknown): CalendarEvent[] {
  const rows = asLuaArray(value);
  if (!rows) {
    return [];
  }

  return rows
    .filter((event): event is Record<string, unknown> => !!event && typeof event === "object")
    .map((event) => {
      const attendees = parseCalendarAttendees(event.attendees);
      return {
        wowEventId: asNumber(event.wowEventId),
        title: asString(event.title),
        eventType: event.eventType === "world" ? "world" : "raid",
        startTime: asNumber(event.startTime),
        endTime: asNumber(event.endTime),
        ...(attendees ? { attendees } : {}),
      };
    });
}

function parseGuildOrders(value: unknown): GuildOrder[] {
  const rows = asLuaArray(value);
  if (!rows) {
    return [];
  }

  return rows
    .filter((order): order is Record<string, unknown> => !!order && typeof order === "object")
    .map((order) => ({
      orderId: asNumber(order.orderId),
      itemId: asNumber(order.itemId),
      spellId: asNumber(order.spellId),
      orderType: "guild",
      orderState: asNumber(order.orderState),
      expirationTime: asNumber(order.expirationTime),
      ...(typeof order.claimEndTime === "number"
        ? { claimEndTime: order.claimEndTime }
        : {}),
      ...(typeof order.minQuality === "number" ? { minQuality: order.minQuality } : {}),
      ...(typeof order.tipAmount === "number" ? { tipAmount: order.tipAmount } : {}),
      ...(typeof order.consortiumCut === "number"
        ? { consortiumCut: order.consortiumCut }
        : {}),
      isRecraft: order.isRecraft === true,
      isFulfillable: order.isFulfillable === true,
      ...(typeof order.reagentState === "number"
        ? { reagentState: order.reagentState }
        : {}),
      ...(typeof order.customerGuid === "string"
        ? { customerGuid: order.customerGuid }
        : {}),
      ...(typeof order.customerName === "string"
        ? { customerName: order.customerName }
        : {}),
      ...(typeof order.crafterGuid === "string"
        ? { crafterGuid: order.crafterGuid }
        : {}),
      ...(typeof order.crafterName === "string"
        ? { crafterName: order.crafterName }
        : {}),
      ...(typeof order.customerNotes === "string"
        ? { customerNotes: order.customerNotes }
        : {}),
      ...(typeof order.outputItemHyperlink === "string"
        ? { outputItemHyperlink: order.outputItemHyperlink }
        : {}),
      ...(typeof order.recraftItemHyperlink === "string"
        ? { recraftItemHyperlink: order.recraftItemHyperlink }
        : {}),
    }));
}

function parseSimcRequest(value: unknown): SimcRequest | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const request = value as Record<string, unknown>;
  const requestId = asString(request.requestId);
  const characterName = asString(request.characterName);
  const realmName = asString(request.realmName);
  const profileText = asString(request.profileText)
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r");
  const requestedAt = asNumber(request.requestedAt);

  if (!requestId || !characterName || !realmName || !profileText || requestedAt <= 0) {
    return undefined;
  }

  return {
    requestId,
    requestedAt,
    characterName,
    realmName,
    profileText,
    runDroptimizerNow: asBoolean(request.runDroptimizerNow),
  };
}

function parseScopeSignatures(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      typeof entry === "string" && entry.length > 0 ? [[key, entry]] : []
    )
  );
}

function parsePendingReload(value: unknown): PendingReloadState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const pending = value as Record<string, unknown>;
  const subjectKey = asString(pending.subjectKey).trim().toLowerCase();
  const payloadVersion = asNumber(pending.payloadVersion);
  const payloadFingerprint = asString(pending.payloadFingerprint).trim();

  if (!subjectKey || payloadVersion <= 0 || !payloadFingerprint) {
    return undefined;
  }

  return {
    subjectKey,
    ...(asString(pending.subjectName).trim()
      ? { subjectName: asString(pending.subjectName).trim() }
      : {}),
    payloadVersion,
    payloadFingerprint,
    changedScopes: asLuaArray(pending.changedScopes)
      ?.flatMap((entry) => {
        const scope = asString(entry).trim();
        return scope ? [scope] : [];
      }) ?? [],
    scopeSignatures: parseScopeSignatures(pending.scopeSignatures),
    ...(asNumber(pending.createdAt) > 0 ? { createdAt: asNumber(pending.createdAt) } : {}),
    ...(asNumber(pending.updatedAt) > 0 ? { updatedAt: asNumber(pending.updatedAt) } : {}),
  };
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
  const guildOrders = (root.guildOrders as Record<string, unknown>) ?? {};
  const simcRequest = parseSimcRequest(root.simcRequest);
  const pendingReload = parsePendingReload(root.pendingReload);

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
    guildOrders: {
      lastScannedAt: asNumber(guildOrders.lastScannedAt),
      orders: parseGuildOrders(guildOrders.orders),
    },
    ...(simcRequest ? { simcRequest } : {}),
    ...(pendingReload ? { pendingReload } : {}),
  };
}
