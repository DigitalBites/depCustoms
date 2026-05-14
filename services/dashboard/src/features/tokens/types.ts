export interface TokenActor {
  user_id: string;
  email: string | null;
  provider: string | null;
}

export interface ProjectToken {
  id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  owner_user_id: string;
  created_by_user_id: string;
  revoked_by_user_id: string | null;
  owner: TokenActor | null;
  created_by: TokenActor | null;
  revoked_by: TokenActor | null;
}

export interface CreatedProjectToken {
  token: string;
  id: string;
  prefix: string;
  expires_at: string | null;
}
