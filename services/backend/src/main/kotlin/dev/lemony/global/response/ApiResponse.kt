package dev.lemony.global.response

import com.fasterxml.jackson.annotation.JsonInclude

// flowstock 컨벤션을 그대로 따른 공통 응답 래퍼.
@JsonInclude(JsonInclude.Include.NON_NULL)
data class ApiResponse<T>(
    val success: Boolean,
    val data: T? = null,
    val message: String? = null,
    val errorCode: String? = null,
) {
    companion object {
        fun <T> success(data: T, message: String? = null) =
            ApiResponse(success = true, data = data, message = message)

        fun error(errorCode: String, message: String) =
            ApiResponse<Unit>(success = false, errorCode = errorCode, message = message)
    }
}
