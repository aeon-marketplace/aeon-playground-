export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  created_at: number;
};

export type SessionRow = {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
};

export type CredentialRow = {
  id: string;
  user_id: string;
  provider_id: string;
  ciphertext: string;
  iv: string;
  tag: string;
  key_hint: string;
  verified: number;
  verified_models: string | null;
  verified_at: number | null;
  verification_error: string | null;
  created_at: number;
  updated_at: number;
};

export type CustomModelRow = {
  id: string;
  user_id: string;
  name: string;
  base_url: string;
  model_id: string;
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
  key_hint: string | null;
  capabilities: string;
  verified: number;
  verified_at: number | null;
  verification_error: string | null;
  created_at: number;
  updated_at: number;
};

export type TestRunRow = {
  id: string;
  user_id: string;
  kind: string;
  group_id: string | null;
  model_ref: string;
  provider_id: string;
  model_id: string;
  prompt: string;
  output: string | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  usage_available: number;
  provider_request_id: string | null;
  image_path: string | null;
  access_type: string | null;
  provider_name: string | null;
  model_name: string | null;
  system_prompt: string | null;
  image_width: number | null;
  image_height: number | null;
  created_at: number;
};

export type UserSettingsRow = {
  user_id: string;
  default_model_ref: string | null;
  default_system_prompt: string;
  updated_at: number;
};
