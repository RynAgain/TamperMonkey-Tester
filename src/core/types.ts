export interface UserScriptMetadata {
  name: string;
  namespace?: string;
  version?: string;
  description?: string;
  author?: string;
  match: string[];
  include: string[];
  exclude: string[];
  require: string[];
  resource: Record<string, string>;
  grant: string[];
  runAt: 'document-start' | 'document-end' | 'document-idle' | 'document-body';
  connect: string[];
  noframes?: boolean;
  icon?: string;
  homepageURL?: string;
  updateURL?: string;
  downloadURL?: string;
  supportURL?: string;
}

export interface UserScript {
  id: string;
  filePath: string;
  metadata: UserScriptMetadata;
  source: string;
  enabled: boolean;
  lastModified: number;
}

export interface DevServerConfig {
  port: number;
  host: string;
  scriptsDir: string;
  open: boolean;
  verbose: boolean;
}

export interface GMStorageEntry {
  scriptId: string;
  key: string;
  value: unknown;
}
