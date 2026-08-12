import Foundation
import SwiftUI

// App configuration. API base URL and small preferences live in
// UserDefaults; the device key lives in the Keychain only.
@MainActor
final class SettingsStore: ObservableObject {
    @Published var apiBaseURLString: String {
        didSet { defaults.set(apiBaseURLString, forKey: "apiBaseUrl") }
    }
    @Published var deviceKey: String {
        didSet { Keychain.save(deviceKey) }
    }
    @Published var machineLabel: String {
        didSet { defaults.set(machineLabel, forKey: "machineLabel") }
    }
    @Published var notifyOnReady: Bool {
        didSet { defaults.set(notifyOnReady, forKey: "notifyOnReady") }
    }
    @Published var skippedOnboarding: Bool {
        didSet { defaults.set(skippedOnboarding, forKey: "skippedOnboarding") }
    }

    private let defaults = UserDefaults.standard

    init() {
        apiBaseURLString = defaults.string(forKey: "apiBaseUrl") ?? ""
        deviceKey = Keychain.load()
        machineLabel = defaults.string(forKey: "machineLabel") ?? "My Mac"
        notifyOnReady = defaults.object(forKey: "notifyOnReady") as? Bool ?? true
        skippedOnboarding = defaults.bool(forKey: "skippedOnboarding")
    }

    var isPaired: Bool { apiClient != nil }

    var apiClient: APIClient? {
        guard !deviceKey.isEmpty,
              let url = URL(string: apiBaseURLString),
              url.scheme == "https" || url.scheme == "http"
        else { return nil }
        return APIClient(baseURL: url, deviceKey: deviceKey)
    }

    var maskedDeviceKey: String {
        guard deviceKey.count > 11 else { return deviceKey.isEmpty ? "not set" : deviceKey }
        return "\(deviceKey.prefix(7)) ···· ···· \(deviceKey.suffix(4))"
    }
}
