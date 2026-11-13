import * as fs from 'fs';
import * as path from 'path';

interface RlsMatrixFile {
  tables: Record<
    string,
    {
      phase: number;
      rls_required: boolean;
      anon: Record<string, boolean | string>;
      authenticated: Record<string, boolean | string>;
      admin: Record<string, boolean | string>;
    }
  >;
}

const ROOT_DIR = path.resolve(__dirname, '../..');
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'supabase', 'migrations');
const MATRIX_PATH = path.join(ROOT_DIR, 'supabase', 'tests', 'rls_matrix.json');
const SRC_DIR = path.join(ROOT_DIR, 'src');

function collectFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Teste Meta de Segurança e RLS (E0-04 / Fase 1 / TEST_STRATEGY.md seção 2)', () => {
  const migrationFiles = collectFiles(MIGRATIONS_DIR, ['.sql']);
  const allMigrationsSql = migrationFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const matrix = JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8')) as RlsMatrixFile;

  const createdTables = Array.from(
    allMigrationsSql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-z0-9_]+)/gi),
  ).map((match) => match[1]!);

  it('encontra todas as 31 tabelas das Fases 0 a 5 nas migrações e bate 1:1 com rls_matrix.json', () => {
    const expectedTables = [
      'account_deletion_log',
      'admin_audit_log',
      'admin_users',
      'app_config',
      'availability_rules',
      'categories',
      'consent_records',
      'conversations',
      'jobs',
      'messages',
      'neighborhoods',
      'notifications',
      'portfolio_items',
      'profiles',
      'provider_categories',
      'provider_documents',
      'provider_neighborhoods',
      'provider_profiles',
      'provider_sensitive_data',
      'push_tokens',
      'quotes',
      'reports',
      'request_matches',
      'request_media',
      'reviews',
      'service_request_private',
      'service_requests',
      'status_events',
      'unserved_demand',
      'user_blocks',
      'verification_submissions',
    ];
    expect(createdTables.sort()).toEqual(expectedTables);
    expect(Object.keys(matrix.tables).sort()).toEqual(expectedTables);
  });

  it('SEC-24 / ADR-13: todas as RPCs bilaterais das Fases 2 e 3 invocam public.can_interact', () => {
    const phase2Migration = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261113020000_phase2_requests_matching_and_quotes.sql'),
      'utf8',
    );
    const bilateralRpcs = ['create_service_request', 'submit_quote', 'edit_quote', 'accept_quote'];
    for (const rpcName of bilateralRpcs) {
      const fnStart = phase2Migration.indexOf(`FUNCTION public.${rpcName}(`);
      expect(fnStart).toBeGreaterThan(-1);
      const fnEnd = phase2Migration.indexOf('$$;', fnStart);
      const fnBody = phase2Migration.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 15000);
      expect(fnBody).toMatch(/public\.can_interact\s*\(/);
    }

    const phase3Migration = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261113030000_phase3_chat_and_notifications.sql'),
      'utf8',
    );
    const sendMsgStart = phase3Migration.indexOf('FUNCTION public.send_message(');
    expect(sendMsgStart).toBeGreaterThan(-1);
    const sendMsgEnd = phase3Migration.indexOf('$$;', sendMsgStart);
    const sendMsgBody = phase3Migration.slice(sendMsgStart, sendMsgEnd);
    expect(sendMsgBody).toMatch(/public\.can_interact\s*\(/);
  });

  it('SEC-06: toda tabela criada em public habilita ROW LEVEL SECURITY', () => {
    for (const tableName of createdTables) {
      const rlsPattern = new RegExp(
        `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?public\\.${tableName}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        'i',
      );
      expect(allMigrationsSql).toMatch(rlsPattern);
    }
  });

  it('SEC-07: toda tabela criada em public revoga escrita direta de anon e authenticated', () => {
    for (const tableName of createdTables) {
      const revokePattern = new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+public\\.${tableName}\\s+FROM\\s+anon,\\s*authenticated`,
        'i',
      );
      expect(allMigrationsSql).toMatch(revokePattern);
    }
  });

  it('TEST_STRATEGY 2.3: toda tabela criada em public consta na rls_matrix.json com anon negado para escrita', () => {
    for (const tableName of createdTables) {
      const entry = matrix.tables[tableName];
      expect(entry).toBeDefined();
      expect(entry?.rls_required).toBe(true);
      expect(entry?.anon.insert).toBe(false);
      expect(entry?.anon.update).toBe(false);
      expect(entry?.anon.delete).toBe(false);
    }
  });

  it('SEC-08: toda função em migrações define SET search_path explícito', () => {
    const functionBlocks = allMigrationsSql
      .split(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i)
      .slice(1);
    expect(functionBlocks.length).toBeGreaterThanOrEqual(12);
    for (const block of functionBlocks) {
      const header = block.split('AS $$')[0] ?? '';
      expect(header).toMatch(/SET\s+search_path\s*=/i);
    }
  });

  it('SEC-15: nenhum arquivo do app em src/ referencia service_role ou SUPABASE_SERVICE_ROLE_KEY', () => {
    const appFiles = collectFiles(SRC_DIR, ['.ts', '.tsx']).filter(
      (f) => !f.endsWith('security-meta.test.ts'),
    );
    for (const filePath of appFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).not.toMatch(/service_role/i);
      expect(content).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/i);
    }
  });
});
