import Foundation

// Which URLs the app will talk to.
//
// HTTPS is accepted anywhere. Plain HTTP is accepted only for addresses on
// the local network — that is the local-mode case (`agent-ready serve` on the
// Mac), and it matches the NSAllowsLocalNetworking exception in Info.plist,
// which is the only way iOS permits cleartext at all. A typo pointing at a
// public http:// host is rejected here rather than failing later inside
// URLSession with an opaque ATS error.
enum ServerURL {
    static func validated(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased(),
              !host.isEmpty
        else { return nil }

        switch scheme {
        case "https":
            return url
        case "http":
            return isLocalHost(host) ? url : nil
        default:
            return nil
        }
    }

    static func isLocalHost(_ host: String) -> Bool {
        if host == "localhost" || host.hasSuffix(".local") { return true }

        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4, parts.allSatisfy({ (0...255).contains($0) }) else {
            return false
        }
        switch (parts[0], parts[1]) {
        case (127, _), (10, _), (192, 168):
            return true
        case (172, 16...31):
            return true
        default:
            return false
        }
    }
}
