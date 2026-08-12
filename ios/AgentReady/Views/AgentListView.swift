import SwiftUI

// The primary screen: which agents need me, in under a second.
//
// @MainActor because the helper view properties below read main-actor state
// (the view model and settings) outside of `body`, which carries the
// isolation on its own.
@MainActor
struct AgentListView: View {
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var model: AgentListViewModel
    @Environment(\.scenePhase) private var scenePhase

    @State private var now = Date()
    @State private var showConnect = false
    private let minuteTick = Timer.publish(every: 60, on: .main, in: .common)
        .autoconnect() // display-only: re-renders relative times; never fetches

    var body: some View {
        NavigationStack {
            Group {
                if model.loadState == .loadingFirst {
                    skeletonList
                } else if model.sessions.isEmpty && settings.isPaired {
                    emptyState
                } else if !settings.isPaired {
                    unpairedState
                } else {
                    sessionList
                }
            }
            .navigationTitle("Agent Ready")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gearshape")
                            .accessibilityLabel("Settings")
                    }
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 8) {
                    if model.showsErrorBanner {
                        ErrorBannerView(lastGood: model.lastGoodFetch) {
                            await model.refresh()
                        }
                    }
                    Text(model.subheader(now: now))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 4)
                .background(Color(.systemBackground))
            }
        }
        .task { await model.refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refresh() } }
        }
        .onReceive(minuteTick) { now = $0 }
        .onAppear {
            showConnect = !settings.isPaired && !settings.skippedOnboarding
        }
        .fullScreenCover(isPresented: $showConnect) {
            // Injected explicitly: presented content is a separate hierarchy.
            ConnectView().environmentObject(settings)
        }
        .onChange(of: settings.isPaired) { _, paired in
            if paired { Task { await model.refresh() } }
        }
    }

    private var sessionList: some View {
        List {
            ForEach(model.sortedSessions(now: now)) { session in
                AgentRowView(
                    session: session,
                    now: now,
                    staleDataAsOf: model.showsErrorBanner ? model.lastGoodFetch : nil
                )
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    if session.displayState(now: now) == .stale {
                        Button(role: .destructive) {
                            Task { await model.delete(session) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .opacity(model.showsErrorBanner ? 0.55 : 1)
        .refreshable { await model.refresh() }
    }

    private var skeletonList: some View {
        List(0..<3, id: \.self) { _ in
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(.tertiary)
                    .frame(width: 180, height: 14)
                RoundedRectangle(cornerRadius: 3)
                    .fill(.tertiary)
                    .frame(width: 120, height: 10)
            }
            .frame(minHeight: 44, alignment: .leading)
        }
        .listStyle(.plain)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("No monitored agents yet")
                .font(.headline)
            (Text("Start one from your Mac with ")
                + Text("agent-ready run -- codex").font(.footnote.monospaced()))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var unpairedState: some View {
        VStack(spacing: 12) {
            Text("Not connected")
                .font(.headline)
            Text("Pair this phone with your Mac to see agent sessions.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button("Connect") { showConnect = true }
                .buttonStyle(.borderedProminent)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// Failed refresh: banner + dimmed last-known list. No modal alerts, no
// toasts. Dismisses itself on the next successful fetch.
struct ErrorBannerView: View {
    let lastGood: Date?
    let retry: () async -> Void

    @State private var retrying = false

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Can't reach the service")
                    .font(.subheadline.weight(.semibold))
                if let lastGood {
                    Text("Showing last known state from \(AgentSession.clock(lastGood)).")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Button {
                retrying = true
                Task {
                    await retry()
                    retrying = false
                }
            } label: {
                if retrying {
                    ProgressView()
                } else {
                    Text("Retry")
                }
            }
            .buttonStyle(.bordered)
            .disabled(retrying)
        }
        .padding(12)
        .frame(minHeight: 44)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.accentColor.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(Color(.separator), lineWidth: 0.5)
                )
        )
    }
}
