// Package testutil provides shared test helpers for the proxy module.
// It is only imported by _test.go files; it is never included in the production binary.
package testutil

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
	gatewayv1 "github.com/getcustoms/proxy/gen/customs/v1"
	"github.com/getcustoms/proxy/gen/customs/v1/customsv1connect"
	"google.golang.org/protobuf/proto"
)

// MockCPHandler is a configurable in-process ConnectRPC handler.
// Nil function fields default to sensible success responses.
type MockCPHandler struct {
	CheckFn       func(*gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error)
	CheckHeaderFn func(http.Header)
	// RecordUsageFn receives the full slice of streamed events once the stream closes.
	RecordUsageFn                            func([]*gatewayv1.RecordUsageRequest) (*gatewayv1.RecordUsageResponse, error)
	RecordUsageHeaderFn                      func(http.Header)
	RecordProxyStatusFn                      func(*gatewayv1.RecordProxyStatusRequest) (*gatewayv1.RecordProxyStatusResponse, error)
	RecordProxyStatusHeaderFn                func(http.Header)
	RecordPackageLatestMetadataFn            func(*gatewayv1.RecordPackageLatestMetadataRequest) (*gatewayv1.RecordPackageLatestMetadataResponse, error)
	RecordPackageLatestMetadataHeaderFn      func(http.Header)
	RecordPackageUsedVersionMetadataFn       func(*gatewayv1.RecordPackageUsedVersionMetadataRequest) (*gatewayv1.RecordPackageUsedVersionMetadataResponse, error)
	RecordPackageUsedVersionMetadataHeaderFn func(http.Header)
	RecordMetadataCacheStatsFn               func(*gatewayv1.RecordMetadataCacheStatsRequest) (*gatewayv1.RecordMetadataCacheStatsResponse, error)
	RecordMetadataCacheStatsHeaderFn         func(http.Header)
	RecordPackageContributorMetadataFn       func(*gatewayv1.RecordPackageContributorMetadataRequest) (*gatewayv1.RecordPackageContributorMetadataResponse, error)
	RecordPackageContributorMetadataHeaderFn func(http.Header)
	TokenExchangeFn                          func(http.Header) (int, any)
}

func (h *MockCPHandler) Check(
	_ context.Context,
	req *connect.Request[gatewayv1.CheckRequest],
) (*connect.Response[gatewayv1.CheckResponse], error) {
	if h.CheckFn == nil {
		return connect.NewResponse(CannedAllow("tenant-1", "project-1", 300)), nil
	}
	if h.CheckHeaderFn != nil {
		h.CheckHeaderFn(req.Header())
	}
	resp, err := h.CheckFn(req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (h *MockCPHandler) RecordUsage(
	_ context.Context,
	stream *connect.ClientStream[gatewayv1.RecordUsageRequest],
) (*connect.Response[gatewayv1.RecordUsageResponse], error) {
	var events []*gatewayv1.RecordUsageRequest
	for stream.Receive() {
		msg := stream.Msg()
		// Clone to avoid sharing the proto buffer and to avoid copying internal locks.
		cp := proto.Clone(msg).(*gatewayv1.RecordUsageRequest)
		events = append(events, cp)
	}
	if err := stream.Err(); err != nil {
		return nil, err
	}
	if h.RecordUsageHeaderFn != nil {
		h.RecordUsageHeaderFn(stream.RequestHeader())
	}
	if h.RecordUsageFn == nil {
		return connect.NewResponse(&gatewayv1.RecordUsageResponse{
			Recorded: int32(len(events)),
		}), nil
	}
	resp, err := h.RecordUsageFn(events)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (h *MockCPHandler) RecordProxyStatus(
	_ context.Context,
	req *connect.Request[gatewayv1.RecordProxyStatusRequest],
) (*connect.Response[gatewayv1.RecordProxyStatusResponse], error) {
	if h.RecordProxyStatusFn == nil {
		return connect.NewResponse(&gatewayv1.RecordProxyStatusResponse{}), nil
	}
	if h.RecordProxyStatusHeaderFn != nil {
		h.RecordProxyStatusHeaderFn(req.Header())
	}
	resp, err := h.RecordProxyStatusFn(req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (h *MockCPHandler) RecordPackageLatestMetadata(
	_ context.Context,
	req *connect.Request[gatewayv1.RecordPackageLatestMetadataRequest],
) (*connect.Response[gatewayv1.RecordPackageLatestMetadataResponse], error) {
	if h.RecordPackageLatestMetadataFn == nil {
		return connect.NewResponse(&gatewayv1.RecordPackageLatestMetadataResponse{}), nil
	}
	if h.RecordPackageLatestMetadataHeaderFn != nil {
		h.RecordPackageLatestMetadataHeaderFn(req.Header())
	}
	resp, err := h.RecordPackageLatestMetadataFn(req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (h *MockCPHandler) RecordPackageUsedVersionMetadata(
	_ context.Context,
	req *connect.Request[gatewayv1.RecordPackageUsedVersionMetadataRequest],
) (*connect.Response[gatewayv1.RecordPackageUsedVersionMetadataResponse], error) {
	if h.RecordPackageUsedVersionMetadataFn == nil {
		return connect.NewResponse(&gatewayv1.RecordPackageUsedVersionMetadataResponse{}), nil
	}
	if h.RecordPackageUsedVersionMetadataHeaderFn != nil {
		h.RecordPackageUsedVersionMetadataHeaderFn(req.Header())
	}
	resp, err := h.RecordPackageUsedVersionMetadataFn(req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (h *MockCPHandler) RecordMetadataCacheStats(
	_ context.Context,
	req *connect.Request[gatewayv1.RecordMetadataCacheStatsRequest],
) (*connect.Response[gatewayv1.RecordMetadataCacheStatsResponse], error) {
	if h.RecordMetadataCacheStatsFn == nil {
		return connect.NewResponse(&gatewayv1.RecordMetadataCacheStatsResponse{}), nil
	}
	if h.RecordMetadataCacheStatsHeaderFn != nil {
		h.RecordMetadataCacheStatsHeaderFn(req.Header())
	}
	resp, err := h.RecordMetadataCacheStatsFn(req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

func (h *MockCPHandler) RecordPackageContributorMetadata(
	_ context.Context,
	req *connect.Request[gatewayv1.RecordPackageContributorMetadataRequest],
) (*connect.Response[gatewayv1.RecordPackageContributorMetadataResponse], error) {
	if h.RecordPackageContributorMetadataFn == nil {
		return connect.NewResponse(&gatewayv1.RecordPackageContributorMetadataResponse{}), nil
	}
	if h.RecordPackageContributorMetadataHeaderFn != nil {
		h.RecordPackageContributorMetadataHeaderFn(req.Header())
	}
	resp, err := h.RecordPackageContributorMetadataFn(req.Msg)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(resp), nil
}

// MakeMockCP starts an httptest.Server that speaks ConnectRPC using the
// provided handler. If handler is nil, a default handler is used that returns
// CannedAllow for all Check calls. The server is closed via t.Cleanup.
func MakeMockCP(t *testing.T, handler *MockCPHandler) *httptest.Server {
	t.Helper()
	if handler == nil {
		handler = &MockCPHandler{}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/internal/v1/proxy/token", func(w http.ResponseWriter, r *http.Request) {
		if handler.TokenExchangeFn == nil {
			_ = json.NewEncoder(w).Encode(map[string]string{
				"access_token":  "runtime-token",
				"expires_at":    "2030-01-01T00:15:00Z",
				"refresh_after": "2030-01-01T00:12:00Z",
			})
			return
		}
		status, body := handler.TokenExchangeFn(r.Header)
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	})
	path, h := customsv1connect.NewGatewayServiceHandler(handler)
	mux.Handle(path, h)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}
