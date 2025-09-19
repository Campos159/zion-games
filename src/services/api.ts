// src/services/api.ts
import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";

const isDev = import.meta.env.DEV;

class API {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: isDev
        ? "/api" // <- usa o proxy do Vite no dev
        : (import.meta.env.VITE_API_URL || "https://SEU_BACKEND_PROD"),
      timeout: 15000,
    });

    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers = config.headers || {};
        (config.headers as any).Authorization = `Bearer ${this.token}`;
      }
      return config;
    });
  }

  setToken(token: string | null) { this.token = token; }

  get<T>(url: string, cfg?: AxiosRequestConfig) { return this.client.get<T>(url, cfg); }
  post<T>(url: string, data?: any, cfg?: AxiosRequestConfig) { return this.client.post<T>(url, data, cfg); }
  put<T>(url: string, data?: any, cfg?: AxiosRequestConfig) { return this.client.put<T>(url, data, cfg); }
  patch<T>(url: string, data?: any, cfg?: AxiosRequestConfig) { return this.client.patch<T>(url, data, cfg); }
  delete<T>(url: string, cfg?: AxiosRequestConfig) { return this.client.delete<T>(url, cfg); }
}

export const api = new API();
