import fs from 'fs-extra';
import { BATCH_SIZE } from '../core/constants.js';
import {
  clearTable,
  copyDatabaseFile,
  countRows,
  insertBatch,
  iterateBatched,
  openReadonlyCopy,
  openWritable,
  tableExists,
} from '../database/sqlite.js';
import type { StageResult } from '../types/index.js';
import { BaseMigrator, type MigratorContext } from './base.js';

const WEB_DATA_TABLES = [
  'autofill',
  'autofill_model_type_state',
  'autofill_sync_metadata',
  'autofill_profiles',
  'autofill_profile_names',
  'autofill_profile_emails',
  'autofill_profile_phones',
  'autofill_profile_addresses',
  'autofill_profile_birthdates',
  'contact_info',
  'local_addresses',
  'local_addresses_type_tokens',
  'server_addresses',
  'masked_credit_cards',
  'unmasked_credit_cards',
  'server_card_metadata',
  'server_card_cloud_token_data',
  'offer_data',
  'offer_eligible_instrument',
  'offer_merchant_domain',
  'payments_customer_data',
  'payments_upi_vpa',
  'local_ibans',
  'server_ibans',
  'credit_cards',
  'keywords',
  'keyword_images',
  'token_service',
  'web_app_manifest_section',
  'web_apps_icon_mappings',
] as const;

export class AutofillMigrator extends BaseMigrator {
  readonly stage = 'autofill' as const;
  readonly label = 'Migrating autofill';

  protected async migrate(ctx: MigratorContext): Promise<Partial<StageResult>> {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!(await fs.pathExists(ctx.source.webData))) {
      return {
        itemsFound: 0,
        itemsTransferred: 0,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings: ['No Web Data database found'],
        errors: [],
      };
    }

    const src = await openReadonlyCopy(ctx.source.webData);
    let found = 0;
    try {
      if (tableExists(src.db, 'autofill')) found += countRows(src.db, 'autofill');
      if (tableExists(src.db, 'autofill_profiles')) found += countRows(src.db, 'autofill_profiles');
      if (tableExists(src.db, 'local_addresses')) found += countRows(src.db, 'local_addresses');
      if (tableExists(src.db, 'keywords')) found += countRows(src.db, 'keywords');
      // Credit card metadata only — never attempt to decrypt/export PAN data to logs
      if (tableExists(src.db, 'credit_cards')) found += countRows(src.db, 'credit_cards');
      if (tableExists(src.db, 'masked_credit_cards'))
        found += countRows(src.db, 'masked_credit_cards');
    } finally {
      await src.close();
    }

    if (ctx.dryRun) {
      return {
        itemsFound: found,
        itemsTransferred: found,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings: [
          ...warnings,
          'Credit card numbers remain encrypted; only metadata/masked cards are transferable',
        ],
        errors,
        details: { dryRun: true },
      };
    }

    const copied = await copyDatabaseFile(ctx.source.webData, ctx.target.webData);
    if (copied) {
      return {
        itemsFound: found,
        itemsTransferred: found,
        itemsSkipped: 0,
        itemsFailed: 0,
        warnings: [
          ...warnings,
          'Full Web Data copied including encrypted card metadata',
        ],
        errors,
        details: { method: 'file-copy' },
      };
    }

    // Merge fallback
    const source = await openReadonlyCopy(ctx.source.webData);
    let transferred = 0;
    try {
      const dest = await openWritable(ctx.target.webData);
      try {
        for (const table of WEB_DATA_TABLES) {
          if (!tableExists(source.db, table) || !tableExists(dest, table)) {
            if (tableExists(source.db, table)) {
              warnings.push(`Target missing table ${table}; skipped`);
            }
            continue;
          }
          clearTable(dest, table);
          for (const batch of iterateBatched<Record<string, unknown>>(
            source.db,
            table,
            BATCH_SIZE.autofill,
          )) {
            transferred += insertBatch(dest, table, batch, { replace: true });
          }
        }
      } finally {
        dest.close();
      }
    } catch (err) {
      errors.push(String(err));
    } finally {
      await source.close();
    }

    return {
      itemsFound: found,
      itemsTransferred: transferred > 0 ? found : 0,
      itemsSkipped: 0,
      itemsFailed: errors.length,
      warnings,
      errors,
      details: { method: 'merge' },
    };
  }
}
