package client

import (
	"context"
	"net/http"

	"connectrpc.com/connect"
)

type runtimeAuthInterceptor struct {
	client *Client
}

func (i runtimeAuthInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		if err := i.client.ensureRuntimeToken(ctx); err != nil {
			return nil, err
		}
		if err := i.client.setRuntimeAuthHeader(req.Header()); err != nil {
			return nil, err
		}
		return next(ctx, req)
	}
}

func (i runtimeAuthInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return func(ctx context.Context, spec connect.Spec) connect.StreamingClientConn {
		if err := i.client.ensureRuntimeToken(ctx); err != nil {
			return &interceptedStreamingClientConn{err: err}
		}
		conn := next(ctx, spec)
		if err := i.client.setRuntimeAuthHeader(conn.RequestHeader()); err != nil {
			return &interceptedStreamingClientConn{err: err}
		}
		return conn
	}
}

func (i runtimeAuthInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return next
}

type interceptedStreamingClientConn struct {
	err error
}

func (c *interceptedStreamingClientConn) Spec() connect.Spec           { return connect.Spec{} }
func (c *interceptedStreamingClientConn) Peer() connect.Peer           { return connect.Peer{} }
func (c *interceptedStreamingClientConn) RequestHeader() http.Header   { return make(http.Header) }
func (c *interceptedStreamingClientConn) ResponseHeader() http.Header  { return make(http.Header) }
func (c *interceptedStreamingClientConn) ResponseTrailer() http.Header { return make(http.Header) }
func (c *interceptedStreamingClientConn) Send(any) error               { return c.err }
func (c *interceptedStreamingClientConn) CloseRequest() error          { return c.err }
func (c *interceptedStreamingClientConn) Receive(any) error            { return c.err }
func (c *interceptedStreamingClientConn) CloseResponse() error         { return c.err }
