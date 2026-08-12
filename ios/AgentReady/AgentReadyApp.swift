import SwiftUI

@main
@MainActor // init() builds the main-actor-isolated stores
struct AgentReadyApp: App {
    @StateObject private var settings: SettingsStore
    @StateObject private var model: AgentListViewModel

    init() {
        let settings = SettingsStore()
        _settings = StateObject(wrappedValue: settings)
        _model = StateObject(wrappedValue: AgentListViewModel(settings: settings))
    }

    var body: some Scene {
        WindowGroup {
            AgentListView()
                .environmentObject(settings)
                .environmentObject(model)
        }
    }
}
