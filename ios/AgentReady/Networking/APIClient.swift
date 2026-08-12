import Foundation

// The app's entire network surface: GET /agents and DELETE /agents.
// Authenticated with the device key; the app never holds any Supabase
// credential (docs/contract.md).
struct APIClient {
    enum APIError: LocalizedError {
        case badStatus(Int)
        var errorDescription: String? {
            switch self {
            case .badStatus(let code): "Service returned \(code)"
            }
        }
    }

    let baseURL: URL
    let deviceKey: String

    func fetchAgents() async throws -> [AgentSession] {
        let data = try await send(request(path: "agents"))
        return try Self.decoder.decode([AgentSession].self, from: data)
    }

    func deleteAgent(sessionId: UUID) async throws {
        var components = URLComponents(
            url: baseURL.appending(path: "agents"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "session_id", value: sessionId.uuidString.lowercased())
        ]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(deviceKey)", forHTTPHeaderField: "Authorization")
        _ = try await send(request)
    }

    private func request(path: String) -> URLRequest {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.setValue("Bearer \(deviceKey)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 15
        return request
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw APIError.badStatus((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return data
    }

    // Postgres timestamps may or may not carry fractional seconds.
    private static let decoder: JSONDecoder = {
        let plain = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let string = try decoder.singleValueContainer().decode(String.self)
            if let date = fractional.date(from: string) ?? plain.date(from: string) {
                return date
            }
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Unrecognized date: \(string)"
            ))
        }
        return decoder
    }()
}
