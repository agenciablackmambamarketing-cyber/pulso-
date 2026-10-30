/** Backend-only provider boundary; account-specific auth/mapping required for future providers. */
export type ProviderName = 'meta' | 'google_ads' | 'taboola';
export interface ConversionReceipt {
 accepted: boolean;
 retryable: boolean;
 http_status: number;
 meta_error_code: number | null;
 error_code: string | null;
 response_id: string | null;
}
export interface ConversionProvider<Event, Credential> {
 readonly name: ProviderName;
 send(event: Event, credential: Credential, config: {version: string; allowProduction?: boolean}): Promise<ConversionReceipt>;
}
