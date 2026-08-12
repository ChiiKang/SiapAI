import Foundation

// State per the design README:
//   loadState: idle | loadingFirst | refreshing | loaded | failed
//   a failed refresh must never blank the list — last good data stays.
@MainActor
final class AgentListViewModel: ObservableObject {
    enum LoadState: Equatable {
        case idle, loadingFirst, refreshing, loaded, failed
    }

    @Published private(set) var sessions: [AgentSession] = []
    @Published private(set) var loadState: LoadState = .idle
    @Published private(set) var lastGoodFetch: Date?

    private let settings: SettingsStore

    init(settings: SettingsStore) {
        self.settings = settings
    }

    var showsErrorBanner: Bool { loadState == .failed }

    // READY -> RUNNING -> STALE, most recently updated first within a group.
    nonisolated static func sort(_ sessions: [AgentSession], now: Date) -> [AgentSession] {
        sessions.sorted { a, b in
            let rankA = a.displayState(now: now).sortRank
            let rankB = b.displayState(now: now).sortRank
            if rankA != rankB { return rankA < rankB }
            return a.updatedAt > b.updatedAt
        }
    }

    func sortedSessions(now: Date) -> [AgentSession] {
        Self.sort(sessions, now: now)
    }

    func refresh() async {
        guard let api = settings.apiClient else { return }
        switch loadState {
        case .idle, .loadingFirst:
            loadState = sessions.isEmpty ? .loadingFirst : .refreshing
        case .refreshing:
            return // a fetch is already in flight
        case .loaded, .failed:
            loadState = .refreshing
        }

        do {
            sessions = try await api.fetchAgents()
            lastGoodFetch = Date()
            loadState = .loaded
        } catch {
            // Keep showing last known data; the banner explains (design README §5).
            loadState = .failed
        }
    }

    // Destructive swipe on a STALE row: remove locally and on the server.
    func delete(_ session: AgentSession) async {
        sessions.removeAll { $0.id == session.id }
        guard let api = settings.apiClient else { return }
        try? await api.deleteAgent(sessionId: session.id)
    }

    // "UPDATED NOW · 4 SESSIONS" / "LOADING…"
    func subheader(now: Date) -> String {
        if loadState == .loadingFirst { return "LOADING…" }
        guard let fetched = lastGoodFetch else { return "NOT CONNECTED" }
        let minutes = Int(now.timeIntervalSince(fetched)) / 60
        let when = minutes < 1 ? "NOW" : "\(minutes) MIN AGO"
        let count = sessions.count
        return "UPDATED \(when) · \(count) SESSION\(count == 1 ? "" : "S")"
    }
}
