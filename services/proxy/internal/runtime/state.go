package proxyruntime

import "sync/atomic"

// RuntimeState tracks the proxy's current view of control-plane connectivity
// and runtime-token refresh health. These states intentionally diverge:
// the control plane can be reachable while token refresh is failing.
type RuntimeState struct {
	controlPlaneReachable atomic.Bool
	authRefreshHealthy    atomic.Bool
}

func NewRuntimeState() *RuntimeState {
	state := &RuntimeState{}
	state.authRefreshHealthy.Store(true)
	return state
}

func (s *RuntimeState) ControlPlaneReachable() bool { return s.controlPlaneReachable.Load() }
func (s *RuntimeState) AuthRefreshHealthy() bool    { return s.authRefreshHealthy.Load() }

func (s *RuntimeState) SetControlPlaneReachable(v bool) { s.controlPlaneReachable.Store(v) }
func (s *RuntimeState) SetAuthRefreshHealthy(v bool)    { s.authRefreshHealthy.Store(v) }
