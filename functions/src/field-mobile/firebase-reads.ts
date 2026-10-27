import type { Database, Query } from 'firebase-admin/database';
import type { WorkspaceReads } from './workspace.js';
import type { CustomerSiteReads } from './sites.js';

export function firebaseCustomerSiteReads(database: Database): CustomerSiteReads {
  return {
    async listCustomers(after, limit) {
      const ref = database.ref('crmCompany/data/customers');
      const query = after ? ref.orderByKey().startAfter(after) : ref.orderByKey();
      const snapshot = await query.limitToFirst(limit).get();
      const rows: { key: string; value: unknown }[] = [];
      snapshot.forEach(child => { rows.push({ key: child.key!, value: child.val() }); });
      return rows;
    },
    async readCustomer(id) { return (await database.ref(`crmCompany/data/customers/${id}`).get()).val(); },
  };
}

export function firebaseWorkspaceReads(database: Database): WorkspaceReads {
  return {
    async listOrders(actor, after, limit) {
      const ref = database.ref('crmCompany/workOrders'); let query: Query;
      if (actor.role === 'admin') query = after ? ref.orderByKey().startAfter(after) : ref.orderByKey();
      else query = after ? ref.orderByChild('assigneeUid').startAfter(actor.uid, after).endAt(actor.uid) : ref.orderByChild('assigneeUid').equalTo(actor.uid);
      const snapshot = await query.limitToFirst(limit).get();
      const rows: { key: string; value: unknown }[] = [];
      snapshot.forEach(child => { rows.push({ key: child.key!, value: child.val() }); });
      return rows;
    },
    async readOrder(id) { return (await database.ref(`crmCompany/workOrders/${id}`).get()).val(); },
    async readBuilding(id) { return (await database.ref(`crmCompany/data/buildings/${id}`).get()).val(); },
  };
}
