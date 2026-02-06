package main

import (
	"flag"
	"fmt"
	"math/big"
	"os"
	"sort"
	"strings"
)

type Gate struct {
	ID          int
	K           int
	In          string
	OutContinue string
	LeafIDs     []int
	LeafDen     *big.Int // size = 1/LeafDen
}

type Leaf struct {
	ID      int
	Den     *big.Int // size = 1/Den
	To      string   // OUT or WAREHOUSE
	FromGID int
}

func main() {
	energy := flag.Uint64("energy", 0, "battery output power (W)")
	timeSec := flag.Uint64("time", 0, "battery duration (s)")
	target := flag.Uint64("target", 0, "target power (W)")
	maxGates := flag.Uint64("max", 0, "max gates")
	tStr := flag.String("t", "0.5", "battery generation rate (batteries/s), rational like 0.5 or 1/2")
	flag.Parse()

	if *energy == 0 || *timeSec == 0 {
		exitErr("energy and time must be > 0")
	}

	tRat := new(big.Rat)
	if _, ok := tRat.SetString(*tStr); !ok {
		exitErr("invalid t; use a rational like 0.5 or 1/2")
	}
	if tRat.Sign() <= 0 {
		exitErr("t must be > 0")
	}

	eInt := new(big.Int).Mul(new(big.Int).SetUint64(*energy), new(big.Int).SetUint64(*timeSec))
	p := new(big.Int).Mul(eInt, tRat.Num())
	q := new(big.Int).Set(tRat.Denom())
	reduceFrac(p, q)

	pInRat := new(big.Rat).SetFrac(new(big.Int).Set(p), new(big.Int).Set(q))
	targetRat := new(big.Rat).SetInt(new(big.Int).SetUint64(*target))
	if pInRat.Cmp(targetRat) <= 0 {
		fmt.Println("NO SOLUTION: target >= P_in; output power cannot exceed target")
		return
	}

	best, ok := findBest(p, q, new(big.Int).SetUint64(*target), int(*maxGates))
	if !ok {
		fmt.Println("NO SOLUTION: no feasible fraction found")
		return
	}

	gates, leaves, outLeafIDs := buildDAG(best)

	printResult(p, q, new(big.Int).SetUint64(*target), best, gates, leaves, outLeafIDs)
}

func exitErr(msg string) {
	fmt.Fprintln(os.Stderr, "ERROR:", msg)
	os.Exit(1)
}

type Best struct {
	A int
	B int
	M *big.Int
	D *big.Int
}

func findBest(p, q, target *big.Int, maxGates int) (Best, bool) {
	one := big.NewInt(1)
	best := Best{}
	found := false

	two := big.NewInt(2)
	three := big.NewInt(3)

	D2 := big.NewInt(1)
	for a := 0; a <= maxGates; a++ {
		D := new(big.Int).Set(D2)
		for b := 0; b <= maxGates-a; b++ {
			m := computeM(target, D, p, q)
			if m.Cmp(D) <= 0 {
				if !found || fracLess(m, D, best.M, best.D) || (fracEqual(m, D, best.M, best.D) && (a+b) < (best.A+best.B)) {
					best = Best{A: a, B: b, M: new(big.Int).Set(m), D: new(big.Int).Set(D)}
					found = true
				}
			}

			D.Mul(D, three)
		}
		D2.Mul(D2, two)
	}

	if !found {
		return Best{}, false
	}
	if best.M.Cmp(one) < 0 {
		return Best{}, false
	}
	return best, true
}

func computeM(target, D, p, q *big.Int) *big.Int {
	num := new(big.Int).Mul(target, D)
	num.Mul(num, q)
	m := new(big.Int).Quo(num, p)
	m.Add(m, big.NewInt(1))
	return m
}

func fracLess(m1, d1, m2, d2 *big.Int) bool {
	if m2 == nil || d2 == nil {
		return true
	}
	left := new(big.Int).Mul(m1, d2)
	right := new(big.Int).Mul(m2, d1)
	return left.Cmp(right) < 0
}

func fracEqual(m1, d1, m2, d2 *big.Int) bool {
	if m2 == nil || d2 == nil {
		return false
	}
	left := new(big.Int).Mul(m1, d2)
	right := new(big.Int).Mul(m2, d1)
	return left.Cmp(right) == 0
}

func reduceFrac(p, q *big.Int) {
	g := new(big.Int).GCD(nil, nil, p, q)
	if g.Sign() == 0 || g.Cmp(big.NewInt(1)) == 0 {
		return
	}
	p.Quo(p, g)
	q.Quo(q, g)
}

func buildDAG(best Best) ([]Gate, []Leaf, []int) {
	if best.A == 0 && best.B == 0 {
		// No gates; direct output.
		leaf := Leaf{ID: 1, Den: big.NewInt(1), To: "OUT", FromGID: 0}
		return nil, []Leaf{leaf}, []int{1}
	}

	kList := make([]int, 0, best.A+best.B)
	for i := 0; i < best.B; i++ { // all 1/3 first
		kList = append(kList, 3)
	}
	for i := 0; i < best.A; i++ { // then 1/2
		kList = append(kList, 2)
	}

	gates := make([]Gate, 0, len(kList))
	leaves := make([]Leaf, 0)

	mRemain := new(big.Int).Set(best.M)
	DRemain := new(big.Int).Set(best.D)
	den := big.NewInt(1)
	leafID := 1

	for i, k := range kList {
		den.Mul(den, big.NewInt(int64(k)))
		DRemain.Div(DRemain, big.NewInt(int64(k)))

		// x = number of leaves at this gate routed to OUT
		x := new(big.Int).Quo(mRemain, DRemain)
		maxX := int64(k - 1)
		if x.Cmp(big.NewInt(maxX)) > 0 {
			x.SetInt64(maxX)
		}

		// mRemain -= x * DRemain
		if x.Sign() > 0 {
			xMul := new(big.Int).Mul(x, DRemain)
			mRemain.Sub(mRemain, xMul)
		}

		gate := Gate{ID: i + 1, K: k, In: "IN", LeafDen: new(big.Int).Set(den)}
		if i > 0 {
			gate.In = fmt.Sprintf("G%d.out0", i)
		}

		// create k-1 leaves for this gate
		for j := 0; j < k-1; j++ {
			to := "WAREHOUSE"
			if int64(j) < x.Int64() {
				to = "OUT"
			}
			leaf := Leaf{ID: leafID, Den: new(big.Int).Set(den), To: to, FromGID: gate.ID}
			leaves = append(leaves, leaf)
			gate.LeafIDs = append(gate.LeafIDs, leafID)
			leafID++
		}

		// continue output
		if i == len(kList)-1 {
			// final active leaf
			to := "WAREHOUSE"
			if mRemain.Cmp(big.NewInt(1)) == 0 {
				to = "OUT"
			}
			leaf := Leaf{ID: leafID, Den: new(big.Int).Set(den), To: to, FromGID: gate.ID}
			leaves = append(leaves, leaf)
			gate.OutContinue = fmt.Sprintf("L%d", leafID)
			leafID++

			// mRemain should now be 0 or 1
			mRemain.SetInt64(0)
		} else {
			gate.OutContinue = fmt.Sprintf("G%d.out0", i+2)
		}

		gates = append(gates, gate)
	}

	outLeafIDs := make([]int, 0)
	for _, l := range leaves {
		if l.To == "OUT" {
			outLeafIDs = append(outLeafIDs, l.ID)
		}
	}
	sort.Ints(outLeafIDs)

	return gates, leaves, outLeafIDs
}

func printResult(p, q, target *big.Int, best Best, gates []Gate, leaves []Leaf, outLeafIDs []int) {
	pInRat := new(big.Rat).SetFrac(new(big.Int).Set(p), new(big.Int).Set(q))
	outRat := new(big.Rat).SetFrac(new(big.Int).Mul(new(big.Int).Set(p), new(big.Int).Set(best.M)), new(big.Int).Mul(new(big.Int).Set(q), new(big.Int).Set(best.D)))

	fmt.Println("RESULT")
	fmt.Printf("P_in = %s W (approx %s W)\n", pInRat.RatString(), pInRat.FloatString(6))
	fmt.Printf("Target = %s W\n", target.String())
	fmt.Printf("Best fraction = %s/%s (gates=%d, a(1/2)=%d, b(1/3)=%d)\n", best.M.String(), best.D.String(), best.A+best.B, best.A, best.B)
	fmt.Printf("Output power = %s W (approx %s W)\n", outRat.RatString(), outRat.FloatString(6))
	fmt.Println()

	if len(gates) == 0 {
		fmt.Println("GATES")
		fmt.Println("(none)")
		fmt.Println("OUT")
		fmt.Println("IN")
		return
	}

	fmt.Println("GATES")
	for _, g := range gates {
		parts := make([]string, 0, g.K)
		parts = append(parts, fmt.Sprintf("out0=%s", g.OutContinue))
		for idx, lid := range g.LeafIDs {
			parts = append(parts, fmt.Sprintf("out%d=L%d", idx+1, lid))
		}
		fmt.Printf("G%d split%d in=%s -> %s\n", g.ID, g.K, g.In, strings.Join(parts, ", "))
	}

	fmt.Println()
	fmt.Println("LEAVES")
	for _, l := range leaves {
		fmt.Printf("L%d size=1/%s from=G%d -> %s\n", l.ID, l.Den.String(), l.FromGID, l.To)
	}

	fmt.Println()
	fmt.Println("OUT")
	if len(outLeafIDs) == 0 {
		fmt.Println("(none)")
		fmt.Println()
		printConnections(gates, leaves)
		return
	}
	outIDs := make([]string, 0, len(outLeafIDs))
	for _, id := range outLeafIDs {
		outIDs = append(outIDs, fmt.Sprintf("L%d", id))
	}
	fmt.Printf("merge(%s)\n", strings.Join(outIDs, ", "))

	fmt.Println()
	printConnections(gates, leaves)
}

func printConnections(gates []Gate, leaves []Leaf) {
	fmt.Println("CONNECTIONS")
	if len(gates) == 0 {
		fmt.Println("(none)")
		return
	}
	leafTo := make(map[int]string, len(leaves))
	for _, l := range leaves {
		leafTo[l.ID] = l.To
	}
	for _, g := range gates {
		outs := make([]string, 0, g.K)
		outs = append(outs, gateOutLabel(g.OutContinue, leafTo))
		for _, lid := range g.LeafIDs {
			outs = append(outs, leafTo[lid])
		}
		fmt.Printf("G%d: %s\n", g.ID, strings.Join(outs, " "))
	}
}

func gateOutLabel(out string, leafTo map[int]string) string {
	if strings.HasPrefix(out, "G") {
		parts := strings.SplitN(out, ".", 2)
		return parts[0]
	}
	if strings.HasPrefix(out, "L") {
		idStr := strings.TrimPrefix(out, "L")
		var id int
		_, err := fmt.Sscanf(idStr, "%d", &id)
		if err == nil {
			if to, ok := leafTo[id]; ok {
				return to
			}
		}
	}
	return out
}
