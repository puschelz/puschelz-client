export type GuildBankItem = {
  slotIndex: number;
  itemId: number;
  itemName: string;
  itemIcon: string;
  quantity: number;
};

export type GuildBankTab = {
  tabIndex: number;
  tabName: string;
  items: GuildBankItem[];
};

export type CalendarEvent = {
  wowEventId: number;
  title: string;
  eventType: "raid" | "world";
  startTime: number;
  endTime: number;
  attendees?: CalendarEventAttendee[];
};

export type CalendarEventAttendee = {
  name: string;
  status: "signedUp" | "tentative";
};

export type ParsedPuschelzDb = {
  schemaVersion: number;
  updatedAt: number;
  player?: {
    characterName?: string;
    realmName?: string;
    guildName?: string;
    faction?: string;
    updatedAt?: number;
  };
  guildBank: {
    lastScannedAt: number;
    tabs: GuildBankTab[];
  };
  calendar: {
    lastScannedAt: number;
    events: CalendarEvent[];
  };
};

export type SyncConfig = {
  endpointUrl: string;
  apiToken: string;
  wowPath: string;
};

export type SyncStatus = {
  state: "idle" | "watching" | "syncing" | "error";
  detail: string;
  lastSyncedAt: number | null;
  watchedFile: string | null;
};
