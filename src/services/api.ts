import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";

class API {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:8001",
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

  setToken(token: string | null) {
    this.token = token;
  }

  get<T>(url: string, cfg?: AxiosRequestConfig) { return this.client.get<T>(url, cfg); }
  post<T>(url: string, data?: any, cfg?: AxiosRequestConfig) { return this.client.post<T>(url, data, cfg); }
  put<T>(url: string, data?: any, cfg?: AxiosRequestConfig) { return this.client.put<T>(url, data, cfg); }
  delete<T>(url: string, cfg?: AxiosRequestConfig) { return this.client.delete<T>(url, cfg); }
}

export const api = new API();
