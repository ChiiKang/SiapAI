import Foundation

// One monitored agent session, as served by GET /agents (docs/contract.md).
struct AgentSession: Identifiable, Decodable, Equatable {
    enum Status: String, Decodable {
        case running = "RUNNING"
        case ready = "READY"
    }

    let id: UUID
    let displayName: String
    let machineName: String
    let agentKind: String
    let status: Status
    let startedAt: Date?
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id = "sessionId"
        case displayName, machineName, agentKind, status, startedAt, updatedAt
    }
}

// STALE is derived on the client from updatedAt — never stored, never sent
// (docs/contract.md). RUNNING with no event for 30 minutes displays as STALE.
enum DisplayState {
    case ready, running, stale

    static let staleThreshold: TimeInterval = 30 * 60

    var label: String {
        switch self {
        case .ready: "READY"
        case .running: "RUNNING"
        case .stale: "STALE"
        }
    }

    // Sort order: READY first, then RUNNING, then STALE (within each group,
    // most recently updated first — applied by the view model).
    var sortRank: Int {
        switch self {
        case .ready: 0
        case .running: 1
        case .stale: 2
        }
    }
}

extension AgentSession {
    func displayState(now: Date) -> DisplayState {
        if status == .ready { return .ready }
        return now.timeIntervalSince(updatedAt) > DisplayState.staleThreshold
            ? .stale
            : .running
    }

    // Row metadata per the design README:
    //   READY:   "MacBook Pro · ready 2 min ago"
    //   RUNNING: "MacBook Pro · running 8 min"
    //   STALE:   "MacBook Pro · no signal since 11:02"
    func metadata(now: Date) -> String {
        switch displayState(now: now) {
        case .ready:
            return "\(machineName) · ready \(Self.ago(from: updatedAt, to: now))"
        case .running:
            return "\(machineName) · running \(Self.span(from: startedAt ?? updatedAt, to: now))"
        case .stale:
            return "\(machineName) · no signal since \(Self.clock(updatedAt))"
        }
    }

    // Metadata while the error banner shows last-known state:
    //   "MacBook Pro · stale · 12:44"
    func staleDataMetadata(asOf lastGood: Date) -> String {
        "\(machineName) · stale · \(Self.clock(lastGood))"
    }

    private static func span(from start: Date, to now: Date) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(start)) / 60)
        if minutes < 1 { return "under a min" }
        if minutes < 60 { return "\(minutes) min" }
        return "\(minutes / 60) h \(minutes % 60) min"
    }

    private static func ago(from date: Date, to now: Date) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(date)) / 60)
        if minutes < 1 { return "just now" }
        return "\(span(from: date, to: now)) ago"
    }

    static func clock(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }
}
