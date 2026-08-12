import XCTest
@testable import AgentReady

// Covers the display logic that decides what the owner sees: timestamp
// parsing against the shapes Postgres actually returns, the derived STALE
// rule, sort order, and row metadata. Run in Xcode with Cmd-U.
final class AgentSessionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_760_000_000)

    private func session(
        name: String = "Auth refactor",
        machine: String = "MacBook Pro",
        status: AgentSession.Status = .running,
        startedMinutesAgo: Int = 10,
        updatedMinutesAgo: Int
    ) -> AgentSession {
        let json = """
        {
          "sessionId": "\(UUID().uuidString.lowercased())",
          "displayName": "\(name)",
          "machineName": "\(machine)",
          "agentKind": "Codex",
          "status": "\(status.rawValue)",
          "startedAt": "\(iso(minutesAgo: startedMinutesAgo))",
          "updatedAt": "\(iso(minutesAgo: updatedMinutesAgo))"
        }
        """
        return decode(json)
    }

    private func iso(minutesAgo: Int) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: now.addingTimeInterval(TimeInterval(-60 * minutesAgo)))
    }

    private func decode(_ json: String) -> AgentSession {
        let data = Data(json.utf8)
        // Exercised through the app's own decoder configuration.
        return try! APIClient.decoder.decode(AgentSession.self, from: data)
    }

    // MARK: - Timestamp parsing

    func testParsesEveryTimestampShapePostgresReturns() {
        let shapes = [
            "2026-08-12T12:30:00Z",                  // what the CLI writes
            "2026-08-12T12:30:00+00:00",             // PostgREST, whole seconds
            "2026-08-12T12:30:00.123+00:00",         // milliseconds
            "2026-08-12T12:30:00.123456+00:00",      // microseconds (Postgres default)
            "2026-08-12T14:30:00+02:00",             // non-UTC offset
        ]
        for shape in shapes {
            XCTAssertNotNil(
                APIClient.parseTimestamp(shape),
                "failed to parse \(shape) — the list would show an error banner forever"
            )
        }
        // The offset form must resolve to the same instant as the Z form.
        XCTAssertEqual(
            APIClient.parseTimestamp("2026-08-12T12:30:00Z"),
            APIClient.parseTimestamp("2026-08-12T14:30:00+02:00")
        )
    }

    func testRejectsGarbageTimestamps() {
        XCTAssertNil(APIClient.parseTimestamp("yesterday"))
        XCTAssertNil(APIClient.parseTimestamp(""))
    }

    // MARK: - Derived STALE state

    func testRunningBecomesStaleAfterThirtyMinutesOfSilence() {
        let fresh = session(updatedMinutesAgo: 29)
        let silent = session(updatedMinutesAgo: 31)
        XCTAssertEqual(fresh.displayState(now: now), .running)
        XCTAssertEqual(silent.displayState(now: now), .stale)
    }

    func testReadyIsNeverStaleNoMatterHowOld() {
        let old = session(status: .ready, updatedMinutesAgo: 600)
        XCTAssertEqual(old.displayState(now: now), .ready)
    }

    // MARK: - Sort order

    func testSortsReadyThenRunningThenStaleAndNewestFirst() {
        let readyOld = session(name: "Ready old", status: .ready, updatedMinutesAgo: 20)
        let readyNew = session(name: "Ready new", status: .ready, updatedMinutesAgo: 2)
        let running = session(name: "Running", updatedMinutesAgo: 8)
        let stale = session(name: "Stale", updatedMinutesAgo: 90)

        let sorted = AgentListViewModel.sort([stale, running, readyOld, readyNew], now: now)

        XCTAssertEqual(
            sorted.map(\.displayName),
            ["Ready new", "Ready old", "Running", "Stale"]
        )
    }

    // MARK: - Row metadata

    func testMetadataReadsCorrectlyForEachState() {
        XCTAssertEqual(
            session(status: .ready, updatedMinutesAgo: 2).metadata(now: now),
            "MacBook Pro · ready 2 min ago"
        )
        XCTAssertEqual(
            session(startedMinutesAgo: 8, updatedMinutesAgo: 8).metadata(now: now),
            "MacBook Pro · running 8 min"
        )
        // A stale row reports when the signal stopped, not a duration.
        XCTAssertTrue(
            session(updatedMinutesAgo: 90).metadata(now: now).contains("no signal since")
        )
    }

    // MARK: - Which server URLs are accepted

    func testAcceptsLocalHTTPAndAnyHTTPS() {
        let accepted = [
            "http://192.168.1.24:8787",     // what `agent-ready serve` prints
            "http://10.0.0.5:8787",
            "http://172.16.4.2:8787",
            "http://127.0.0.1:8787",
            "http://localhost:8787",
            "http://my-mac.local:8787",
            "https://abc.supabase.co/functions/v1",
        ]
        for text in accepted {
            XCTAssertNotNil(ServerURL.validated(text), "should accept \(text)")
        }
        // Whitespace from a paste must not break it.
        XCTAssertNotNil(ServerURL.validated("  http://192.168.1.24:8787 "))
    }

    func testRejectsCleartextToThePublicInternetAndJunk() {
        let rejected = [
            "http://example.com",           // ATS would block this anyway
            "http://8.8.8.8:8787",          // public IP, not a local network
            "http://172.32.0.1:8787",       // just outside the private range
            "ftp://192.168.1.24",
            "not a url",
            "",
        ]
        for text in rejected {
            XCTAssertNil(ServerURL.validated(text), "should reject \(text)")
        }
    }

    // MARK: - Decoding the real endpoint payload

    func testDecodesTheAgentsEndpointResponse() throws {
        // Exactly the shape supabase/functions/agents/index.ts returns,
        // including a null startedAt and microsecond timestamps.
        let json = """
        [
          {
            "sessionId": "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9",
            "displayName": "Auth refactor",
            "machineName": "MacBook Pro",
            "agentKind": "Codex",
            "status": "READY",
            "startedAt": null,
            "updatedAt": "2026-08-12T12:30:00.123456+00:00"
          }
        ]
        """
        let sessions = try APIClient.decoder.decode([AgentSession].self, from: Data(json.utf8))
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions[0].displayName, "Auth refactor")
        XCTAssertEqual(sessions[0].status, .ready)
        XCTAssertNil(sessions[0].startedAt)
    }
}
