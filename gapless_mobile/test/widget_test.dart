import 'package:flutter_test/flutter_test.dart';
import 'package:gapless_mobile/main.dart';

void main() {
  testWidgets('GaplessClientApp renders without crashing', (WidgetTester tester) async {
    await tester.pumpWidget(const GaplessClientApp());
    expect(find.byType(GaplessClientApp), findsOneWidget);
  });
}
