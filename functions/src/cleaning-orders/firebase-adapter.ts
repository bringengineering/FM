import type { CleaningOrderRecord } from "./contracts.js";
import type {
  CleaningOrderCreateDependencies,
  CleaningOrderTransitionDependencies,
} from "./runtime.js";
import type {
  CleaningQuoteCreateDependencies,
  CleaningQuoteRecord,
  CleaningQuoteReviewDependencies,
  CleaningQuoteReviewEvent,
} from "./quotes.js";

interface SnapshotLike {
  val(): unknown;
}

interface TransactionResultLike {
  committed: boolean;
  snapshot: SnapshotLike;
}

interface ReferenceLike {
  get(): Promise<SnapshotLike>;
  orderByChild?(path: string): QueryLike;
  transaction(
    update: (current: unknown) => unknown,
    onComplete?: undefined,
    applyLocally?: boolean,
  ): Promise<TransactionResultLike>;
}

interface QueryLike {
  equalTo(value: string): QueryLike;
  limitToLast(limit: number): QueryLike;
  get(): Promise<SnapshotLike>;
}

export interface CleaningOrderDatabaseLike {
  ref(path: string): ReferenceLike;
}

export function createCleaningOrderFirebaseDependencies(
  database: CleaningOrderDatabaseLike,
  now: () => string = () => new Date().toISOString(),
  verifyCompletionPhotoFileIds?: (fileIds: string[]) => Promise<unknown>,
): CleaningOrderCreateDependencies & CleaningOrderTransitionDependencies & CleaningQuoteCreateDependencies & CleaningQuoteReviewDependencies {
  return {
    now,
    ...(verifyCompletionPhotoFileIds ? { verifyCompletionPhotoFileIds } : {}),
    async readCustomer(id) {
      return (await database.ref(`crmCompany/data/customers/${id}`).get()).val();
    },
    async readBuilding(id) {
      return (await database.ref(`crmCompany/data/buildings/${id}`).get()).val();
    },
    async createOrderIfAbsent(order) {
      const result = await database.ref(`crmCompany/cleaningOrders/${order.id}`).transaction(
        current => current === null || current === undefined ? order : undefined,
        undefined,
        false,
      );
      return {
        order: result.snapshot.val() as CleaningOrderRecord | null,
        created: result.committed,
      };
    },
    async readOrder(id) {
      return (await database.ref(`crmCompany/cleaningOrders/${id}`).get()).val();
    },
    async readLinkedWorkOrders(orderId) {
      const workOrdersRef = database.ref("crmCompany/workOrders");
      if (typeof workOrdersRef.orderByChild !== "function") return [];
      const snapshot = await workOrdersRef.orderByChild("cleaningOrderId").equalTo(orderId).limitToLast(50).get();
      const value = snapshot.val();
      return value && typeof value === "object" && !Array.isArray(value)
        ? Object.values(value as Record<string, unknown>)
        : [];
    },
    async readCompletionReports(orderId) {
      const reportsRef = database.ref("crmCompany/workReports");
      if (typeof reportsRef.orderByChild !== "function") return [];
      const snapshot = await reportsRef.orderByChild("cleaningOrderId").equalTo(orderId).limitToLast(50).get();
      const value = snapshot.val();
      return value && typeof value === "object" && !Array.isArray(value)
        ? Object.values(value as Record<string, unknown>)
        : [];
    },
    async updateOrderIfRevision(id, expectedRevision, order) {
      const orderRef = database.ref(`crmCompany/cleaningOrders/${id}`);
      const previous = (await orderRef.get()).val();
      if (!previous || typeof previous !== "object" || Array.isArray(previous)) {
        return { order: null, updated: false };
      }
      const previousOrder = previous as Record<string, unknown>;
      if (previousOrder.id !== id || previousOrder.revision !== expectedRevision) {
        return { order: previous as CleaningOrderRecord, updated: false };
      }
      let usedInitialSnapshot = false;
      const result = await orderRef.transaction(
        current => {
          let candidate = current;
          if ((current === null || current === undefined) && !usedInitialSnapshot) {
            usedInitialSnapshot = true;
            candidate = previous;
          }
          if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
          const stored = candidate as Record<string, unknown>;
          if (stored.id !== id || stored.revision !== expectedRevision) return undefined;
          return order;
        },
        undefined,
        false,
      );
      return {
        order: result.snapshot.val() as CleaningOrderRecord | null,
        updated: result.committed,
      };
    },
    async readQuoteSet(orderId) {
      return (await database.ref(`crmCompany/cleaningOrderQuotes/${orderId}`).get()).val();
    },
    async createRevisionIfCurrent(orderId, expectedRevision, quote) {
      const quoteSetRef = database.ref(`crmCompany/cleaningOrderQuotes/${orderId}`);
      const previous = (await quoteSetRef.get()).val();
      let usedInitialSnapshot = false;
      const result = await quoteSetRef.transaction(current => {
        let candidate = current;
        if ((candidate === null || candidate === undefined) && !usedInitialSnapshot) {
          usedInitialSnapshot = true;
          candidate = previous;
        }
        const stored = candidate === null || candidate === undefined
          ? { orderId, buildingId: quote.buildingId, latestRevision: 0, latestQuoteId: "", revisions: {} }
          : candidate;
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) return undefined;
        const set = stored as Record<string, unknown>;
        const revisions = set.revisions && typeof set.revisions === "object" && !Array.isArray(set.revisions)
          ? set.revisions as Record<string, unknown>
          : null;
        if (set.orderId !== orderId || set.buildingId !== quote.buildingId || !revisions) return undefined;
        const existing = revisions[quote.id];
        if (existing) return undefined;
        if (set.latestRevision !== expectedRevision || quote.revision !== expectedRevision + 1
          || quote.previousQuoteId !== set.latestQuoteId || Object.keys(revisions).length >= 100) return undefined;
        return {
          ...set,
          latestRevision: quote.revision,
          latestQuoteId: quote.id,
          revisions: { ...revisions, [quote.id]: quote },
        };
      }, undefined, false);
      const value = result.snapshot.val();
      const set = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
      const revisions = set && set.revisions && typeof set.revisions === "object" && !Array.isArray(set.revisions)
        ? set.revisions as Record<string, unknown>
        : {};
      return {
        quote: (revisions[quote.id] as CleaningQuoteRecord | undefined) || null,
        latestRevision: Number(set?.latestRevision) || 0,
        created: result.committed,
      };
    },
    async reviewLatestRevisionIfCurrent(orderId, expectedRevision, quoteId, event: CleaningQuoteReviewEvent) {
      const quoteSetRef = database.ref(`crmCompany/cleaningOrderQuotes/${orderId}`);
      const previous = (await quoteSetRef.get()).val();
      let usedInitialSnapshot = false;
      const result = await quoteSetRef.transaction(current => {
        let candidate = current;
        if ((candidate === null || candidate === undefined) && !usedInitialSnapshot) {
          usedInitialSnapshot = true;
          candidate = previous;
        }
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
        const set = candidate as Record<string, unknown>;
        if (set.orderId !== orderId || set.latestRevision !== expectedRevision || set.latestQuoteId !== quoteId
          || !set.revisions || typeof set.revisions !== "object" || Array.isArray(set.revisions)) return undefined;
        const revisions = set.revisions as Record<string, unknown>;
        const rawQuote = revisions[quoteId];
        if (!rawQuote || typeof rawQuote !== "object" || Array.isArray(rawQuote)) return undefined;
        const quote = rawQuote as Record<string, unknown>;
        if (quote.id !== quoteId || quote.orderId !== orderId || quote.revision !== expectedRevision) return undefined;
        const history = Array.isArray(quote.reviewHistory) ? quote.reviewHistory.filter(item => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[] : [];
        const repeated = history.find(item => item.requestId === event.requestId);
        if (repeated || quote.status !== "pending_review" || history.length >= 200) return undefined;
        const nextQuote = {
          ...quote,
          status: event.action === "approve" ? "admin_approved" : "returned",
          reviewHistory: [...history, event],
        };
        return { ...set, revisions: { ...revisions, [quoteId]: nextQuote } };
      }, undefined, false);
      const value = result.snapshot.val();
      const set = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
      const revisions = set && set.revisions && typeof set.revisions === "object" && !Array.isArray(set.revisions)
        ? set.revisions as Record<string, unknown>
        : {};
      return {
        quote: (revisions[quoteId] as CleaningQuoteRecord | undefined) || null,
        latestRevision: Number(set?.latestRevision) || 0,
        updated: result.committed,
      };
    },
  };
}
