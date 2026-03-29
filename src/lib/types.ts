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

export type GuildOrder = {
  orderId: number;
  itemId: number;
  spellId: number;
  orderType: "guild";
  orderState: number;
  expirationTime: number;
  claimEndTime?: number;
  minQuality?: number;
  tipAmount?: number;
  consortiumCut?: number;
  isRecraft: boolean;
  isFulfillable: boolean;
  reagentState?: number;
  customerGuid?: string;
  customerName?: string;
  crafterGuid?: string;
  crafterName?: string;
  customerNotes?: string;
  outputItemHyperlink?: string;
  recraftItemHyperlink?: string;
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
  guildOrders: {
    lastScannedAt: number;
    orders: GuildOrder[];
  };
};

export type SyncConfig = {
  endpointUrl: string;
  apiToken: string;
  wowPath: string;
};

export type BridgeRecipe = {
  spellId: number;
  itemId: number;
  crafterCount: number;
  matchedCharacterKeys: string[];
};

export type BridgeOpenRequest = {
  requestId: string;
  status: "pending_web" | "open_ingame";
  requesterCharacterName: string;
  requesterRealmName: string;
  spellId: number;
  itemId: number;
  itemName: string;
  quality?: number;
  note?: string;
  expiresAt: number;
  matchedCharacterKeys: string[];
};

export type BridgeRequiredAddon = {
  addonId: string;
  name: string;
  description?: string;
  matchFolderNames: string[];
};

export type BridgeSnapshot = {
  snapshotVersion: number;
  requiredAddonsVersion: number;
  requiredAddonsConfiguredCount: number;
  invalidRequiredAddonCount: number;
  generatedAt: number;
  recipes: BridgeRecipe[];
  openRequests: BridgeOpenRequest[];
  requiredAddons: BridgeRequiredAddon[];
};

export type SyncStatus = {
  state: "idle" | "watching" | "syncing" | "error";
  detail: string;
  lastSyncedAt: number | null;
  watchedFile: string | null;
};

export type UpdateStatus = {
  enabled: boolean;
  currentVersion: string;
  availableVersion: string | null;
  state:
    | "unsupported"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "error";
  detail: string;
  checkedAt: number | null;
  restartRequired: boolean;
};

export type RendererState = {
  config: SyncConfig;
  status: SyncStatus;
  updateStatus: UpdateStatus;
};
