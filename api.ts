import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { FilterParams, PaginationParam, PaginationResult, ResponseResultWithPagination, SortingParam } from './types'
import { CONSTANTS, VERTICAL_FIlTER } from '@/lib/constants'
import { getToken } from '@/repositories/auth'
import { cognitoService } from './cognito'
import { queryClient } from '@/components/ReactQueryProvider'
import { statusMerchantSettlement } from './merchantsHoldSettlement.model'

type ApiConfig = {
  baseURL?: string
  timeout?: number
}

export interface ErrorResponseResult {
  errorCode?: number
  errorMessage?: string
  isTimeout?: boolean
  isCancelled?: boolean
  requestUrl?: string
}

export interface ResponseResult<ResultType = any> extends ErrorResponseResult {
  ok: boolean
  result: ResultType | null
}

const DEFAULT_CONFIGS: ApiConfig = {
  baseURL: CONSTANTS.BASE_URL,
  timeout: 10000,
}

export class ApiService {
  apiInstance: AxiosInstance
  private retryCount = 0

  /**
   * @param {ApiConfig} configs
   * @param {string} configs.baseUrl - specify if you want to use a different base url, default is ```BASE_URL```
   * @param {number} configs.timeout - specify if you want longer or shorter timeout, default is 10000
   * @description create an instance of ApiService
   */
  constructor({ baseURL, timeout }: ApiConfig = DEFAULT_CONFIGS) {
    const api = axios.create({
      baseURL: baseURL,
      timeout: timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    this.apiInstance = api
    this.apiInstance.interceptors.request.use(this.defaultRequestInterceptor)
    this.apiInstance.interceptors.response.use(
      (response) => {
        this.retryCount = 0 // reset the retry count on a successful response
        return response
      },
      async (error) => {
        const isUnauthorized = ApiService.isUnauthorized(error)
        const originalRequest = error.config
        if (isUnauthorized && this.retryCount < 3) {
          this.retryCount++ // increment the retry count
          try {
            const response = await cognitoService.refreshSession()

            if (!response?.ok) {
              throw new Error('unauthorized')
            }

            const accessToken = getToken()
            originalRequest.headers.Authorization = `Bearer ${accessToken}`
            return api.request(originalRequest)
          } catch (error) {
            cognitoService.logoutWithHostedUI()
            return error
          }
        }
        this.retryCount = 0 // reset the retry count if the status is not 401 or the retry count is 3
        throw error
      },
    )
  }

  private defaultRequestInterceptor(config: InternalAxiosRequestConfig) {
    const accessToken = getToken()

    if (accessToken) {
      config.headers.set('Authorization', `Bearer ${accessToken}`)
    }
    config.headers.set('x-api-key', process.env.NEXT_PUBLIC_X_API_KEY || '')
    return config
  }

  private defaultResponseInterceptor(response: AxiosResponse) {
    const authHeader = response.headers

    if (authHeader.Authorization) {
      // setJwtToken(authHeader.Authorization)
    }

    return response
  }

  getAbortController() {
    const controller = new AbortController()

    return controller
  }

  private handleResponse<T>(response: AxiosResponse): ResponseResult<T> {
    return {
      ok: true,
      result: response.data,
    }
  }

  private handleError(error: any): ResponseResult<null> {
    const isTimeout = ApiService.isTimeout(error)
    const isCancelled = ApiService.isCancel(error)
    const isKnownError = axios.isAxiosError(error)
    const isHasResponse = error.response

    let errorMessage = ''

    if (isCancelled) {
      errorMessage = 'Request Cancelled'
    } else if (isTimeout) {
      errorMessage = 'Request Timeout'
    } else if (isKnownError && isHasResponse) {
      errorMessage = error.response!.data?.message ?? error.response!.data?.error ?? error.message ?? 'Unexpected Error'
    }

    return {
      ok: false,
      result: null,
      isTimeout,
      isCancelled,
      errorMessage,
      errorCode: error?.response?.status ?? 0,
      requestUrl: error?.response?.config?.url ?? '',
    }
  }

  get<T = any>(url: string, config?: AxiosRequestConfig) {
    return this.apiInstance
      .get<T>(url, config)
      .then(this.handleResponse<T>)
      .catch(this.handleError)
  }

  post<T = any, D = unknown>(url: string, params?: D, config?: AxiosRequestConfig) {
    return this.apiInstance
      .post<T>(url, params, config)
      .then(this.handleResponse<T>)
      .catch(this.handleError)
  }

  put<T = any, D = unknown>(url: string, params?: D, config?: AxiosRequestConfig) {
    return this.apiInstance
      .put<T>(url, params, config)
      .then(this.handleResponse<T>)
      .catch(this.handleError)
  }

  delete<T = any, D = unknown>(url: string, params?: D, config?: AxiosRequestConfig) {
    return this.apiInstance
      .delete<T>(url, {
        params: params,
        ...config,
      })
      .then(this.handleResponse<T>)
      .catch(this.handleError)
  }

  static isCancel(error: any) {
    const isCancelled = axios.isCancel(error)

    return isCancelled
  }

  static isTimeout(error: any) {
    return error.code === 'ECONNABORTED'
  }

  static isUnauthorized(error: any) {
    return error.response?.status === 401
  }

  /**
   *
   * @returns e.g. page=0&per_page=10
   */
  getPaginationParams = (pagination: PaginationParam) => {
    const paginationParams = Object.entries(pagination).map(([key, value]) => `${key}=${value}`)

    return paginationParams.length ? paginationParams.join('&') : ''
  }

  /**
   *
   * @returns e.g. order=-created_at,name without dashed(-) is `asc`
   */
  getSortingParams = (sortings: SortingParam[] = []) => {
    if (!sortings.length) {
      return ''
    }

    const sortingParams = sortings.map((sorting) => `sort[${sorting.sort}]=${sorting.order}`)

    return sortingParams.join('&')
  }

  /**
   *
   * @returns e.g. filter1=value1&filter2=value2&filter3=value3,value4
   */
  getFilterParams = (filters: FilterParams = {}) => {
    if (!Object.keys(filters).length) {
      return ''
    }

    const filterParams = Object.entries(filters).map(([key, value]) => {
      return value ? `filter[${key}]=${value}` : ''
    })

    return filterParams.filter(Boolean).join('&')
  }

  // INFO: This is used for the maker checker api only
  getFilterCheckerParams = (filters: FilterParams = {}) => {
    if (!Object.keys(filters).length) {
      return ''
    }

    const filterParams = Object.entries(filters).map(([key, value]) => {
      return value ? `${key}=${value}` : ''
    })

    return filterParams.filter(Boolean).join('&')
  }

  getQueryCheckerParams = ({
    pagination,
    sortings = [],
    filters = {},
    vertical = '',
  }: {
    pagination?: PaginationParam
    sortings?: SortingParam[]
    filters?: FilterParams
    vertical?: statusMerchantSettlement
  }) => {
    const queryParams: string[] = []

    if (pagination) {
      queryParams.push(this.getPaginationParams(pagination))
    }

    if (sortings) {
      queryParams.push(this.getSortingParams(sortings))
    }

    if (filters) {
      queryParams.push(this.getFilterCheckerParams(filters))
    }

    if (vertical !== 'all') {
      const verticalFilter = VERTICAL_FIlTER[vertical as keyof typeof VERTICAL_FIlTER] || []
      verticalFilter.forEach((filter) => {
        queryParams.push(`vertical[]=${filter}`)
      })
    }
    return queryParams.filter(Boolean).join('&')
  }

  /**
   *
   * @returns e.g. offset=0&limit=10&order=-created_at,name&filter1=value1&filter2=value2&filter3=value3,value4
   */
  getQueryParams = ({
    pagination,
    sortings = [],
    filters = {},
    vertical = '',
  }: {
    pagination?: PaginationParam
    sortings?: SortingParam[]
    filters?: FilterParams
    vertical?: statusMerchantSettlement
  }) => {
    const queryParams: string[] = []

    if (pagination) {
      queryParams.push(this.getPaginationParams(pagination))
    }

    if (sortings) {
      queryParams.push(this.getSortingParams(sortings))
    }

    if (filters) {
      queryParams.push(this.getFilterParams(filters))
    }

    if (vertical !== 'all') {
      const verticalFilter = VERTICAL_FIlTER[vertical as keyof typeof VERTICAL_FIlTER] || []
      verticalFilter.forEach((filter) => {
        queryParams.push(`vertical[]=${filter}`)
      })
    }
    return queryParams.filter(Boolean).join('&')
  }

  getNextPageParam<T = any & ResponseResultWithPagination>(
    lastResponse: (T & ResponseResultWithPagination) | null,
    perPageLimit: any,
  ): PaginationResult | undefined {
    const { offset = 0, limit = perPageLimit, count = 0 } = lastResponse?.pagination || {}

    if (offset + limit < count) {
      return {
        limit,
        offset: offset + limit,
        count,
      }
    }

    return undefined
  }
}
