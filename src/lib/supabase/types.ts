export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      company_signups: {
        Row: {
          id: string
          product: string
          company_name: string
          contact_name: string | null
          email: string
          role: string
          company_size: string
          state: string
          plan: string
          source: string | null
          created_at: string
        }
        Insert: {
          id?: string
          product?: string
          company_name: string
          contact_name?: string | null
          email: string
          role: string
          company_size: string
          state?: string
          plan?: string
          source?: string | null
          created_at?: string
        }
        Update: {
          company_name?: string
          contact_name?: string | null
          email?: string
          role?: string
          company_size?: string
          state?: string
          plan?: string
          source?: string | null
        }
      }
      onboarding_email_events: {
        Row: {
          id: string
          company_id: string
          sequence: string
          email_number: number
          to_email: string
          subject: string
          fired_at: string
          status: string
          delivery: Json
        }
        Insert: {
          id?: string
          company_id: string
          sequence: string
          email_number: number
          to_email: string
          subject: string
          fired_at?: string
          status: string
          delivery?: Json
        }
        Update: {
          status?: string
          delivery?: Json
        }
      }
      brokerages: {
        Row: {
          id: string
          name: string
          broker_user_id: string | null
          invite_code: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          broker_user_id?: string | null
          invite_code?: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          broker_user_id?: string | null
          invite_code?: string
        }
      }
      user_profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          role: 'agent' | 'broker'
          brokerage_id: string | null
          state: 'TN' | 'VA' | 'NC'
          license_number: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_tier: 'free' | 'agent' | 'broker'
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          role?: 'agent' | 'broker'
          brokerage_id?: string | null
          state?: 'TN' | 'VA' | 'NC'
          license_number?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_tier?: 'free' | 'agent' | 'broker'
          created_at?: string
          updated_at?: string
        }
        Update: {
          full_name?: string | null
          role?: 'agent' | 'broker'
          brokerage_id?: string | null
          state?: 'TN' | 'VA' | 'NC'
          license_number?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_tier?: 'free' | 'agent' | 'broker'
        }
      }
      ad_accounts: {
        Row: {
          id: string
          user_id: string
          platform: 'meta' | 'google'
          oauth_token_encrypted: string | null
          refresh_token_encrypted: string | null
          account_id: string | null
          account_name: string | null
          token_expires_at: string | null
          connected_at: string
          needs_reconnect: boolean
        }
        Insert: {
          id?: string
          user_id: string
          platform: 'meta' | 'google'
          oauth_token_encrypted?: string | null
          refresh_token_encrypted?: string | null
          account_id?: string | null
          account_name?: string | null
          token_expires_at?: string | null
          connected_at?: string
          needs_reconnect?: boolean
        }
        Update: {
          oauth_token_encrypted?: string | null
          refresh_token_encrypted?: string | null
          account_id?: string | null
          account_name?: string | null
          token_expires_at?: string | null
          needs_reconnect?: boolean
        }
      }
      ad_performance: {
        Row: {
          id: string
          ad_account_id: string
          date: string
          spend: number
          impressions: number
          clicks: number
          conversions: number
          ctr: number
          ad_set_name: string
          ad_id: string | null
          platform: 'meta' | 'google'
          created_at: string
        }
        Insert: {
          id?: string
          ad_account_id: string
          date: string
          spend: number
          impressions: number
          clicks: number
          conversions: number
          ad_set_name: string
          ad_id?: string | null
          platform: 'meta' | 'google'
          created_at?: string
        }
        Update: {
          spend?: number
          impressions?: number
          clicks?: number
          conversions?: number
          ad_set_name?: string
        }
      }
      compliance_scans: {
        Row: {
          id: string
          user_id: string
          ad_id: string | null
          ad_copy: string
          state: string
          result: 'green' | 'yellow' | 'red'
          flags: ComplianceFlag[]
          analysis_source?: string | null
          ai_explanation: string | null
          scanned_at: string
        }
        Insert: {
          id?: string
          user_id: string
          ad_id?: string | null
          ad_copy: string
          state: string
          result: 'green' | 'yellow' | 'red'
          flags: ComplianceFlag[]
          analysis_source?: string | null
          ai_explanation?: string | null
          scanned_at?: string
        }
        Update: {
          result?: 'green' | 'yellow' | 'red'
          flags?: ComplianceFlag[]
          analysis_source?: string | null
          ai_explanation?: string | null
        }
      }
      weekly_reports: {
        Row: {
          id: string
          user_id: string
          report_date: string
          report_json: Json
          sent_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          report_date: string
          report_json: Json
          sent_at?: string | null
          created_at?: string
        }
        Update: {
          report_json?: Json
          sent_at?: string | null
        }
      }
    }
  }
}

export interface ComplianceFlag {
  rule: string
  severity: 'green' | 'yellow' | 'red'
  explanation: string
  recommendation: string
}
